import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { currentSession, requireUser, newSession, safeUser, rateLimit, guardOrigin, HttpError } from '@/lib/auth';
import { hash, encrypt, decrypt, newTotp, makeTotp, verifyTotp, recoveryCodes } from '@/lib/security';
import { reservedStatuses, todayManila, validDate, orderTransitions, bookingTransitions, canTransition, isOperations } from '@/lib/rules';
import {analyticsWindow,summarizeAnalytics} from '@/lib/analytics';
import {recoveryReady,sendPasswordReset,sendCustomerUpdate,updatesReady} from '@/lib/mail';
import {pickupWindow,weekdayFor,pickupSlots,slotTimes} from '@/lib/pickup';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const name=z.string().trim().min(2).max(100);
const email=z.string().trim().toLowerCase().email().max(254);
const password=z.string().min(12,'Use at least 12 characters.').max(128);
const id=z.string().min(1).max(100);
const date=z.string().refine(validDate,'Choose a valid date.').refine(x=>x>=todayManila(),'Choose today or a future date.');
const money=z.number().int().min(0).max(100000000);
const ops=['ADMIN','STAFF'];
function fail(code:number,message:string):never{throw new HttpError(code,message)}
const audit=async(actor:string,action:string,target:string)=>db.audit.create({data:{actor,action,target}});
const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function emailUpdate(userId:string,subject:string,message:string){if(!updatesReady())return;try{const customer=await db.user.findUnique({where:{id:userId},select:{email:true,active:true}});if(customer?.active)await sendCustomerUpdate(customer.email,subject,message)}catch(e){console.error('Customer update email failed:',e instanceof Error?e.message:'Unknown error')}}
async function read(path:string,req:NextRequest){
 if(path==='setup/status')return {available:!!process.env.ADMIN_SETUP_TOKEN&&await db.user.count({where:{role:'ADMIN'}})===0};
 if(path==='auth/recovery/status')return {available:recoveryReady()};
 if(path.startsWith('menu/image/')){const productId=path.slice('menu/image/'.length);if(!productId||productId.length>100)fail(404,'Photo not found.');const photo=await db.productImage.findUnique({where:{productId}});if(!photo)fail(404,'Photo not found.');return new NextResponse(new Uint8Array(photo.bytes),{headers:{'Content-Type':photo.mimeType,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
 if(path==='catalog')return {products:await db.product.findMany({orderBy:{name:'asc'}}),packages:await db.package.findMany({where:{active:true},orderBy:{price:'asc'}})};
 if(path==='availability'){const month=req.nextUrl.searchParams.get('month')||todayManila().slice(0,7);if(!/^\d{4}-\d{2}$/.test(month))fail(400,'Invalid month');const [bookings,blocks]=await Promise.all([db.booking.findMany({where:{eventDate:{startsWith:month},status:{in:reservedStatuses}},select:{eventDate:true}}),db.blockedDate.findMany({where:{date:{startsWith:month}},select:{date:true}})]);return {unavailable:[...new Set([...bookings.map(b=>b.eventDate),...blocks.map(b=>b.date)])],policy:'One event per cart per day. Requests are subject to confirmation.'};}
 if(path==='pickup/availability'){
  const day=req.nextUrl.searchParams.get('date')||todayManila();
  if(!pickupWindow(day))fail(400,'Choose a date within the next 14 days.');
  const schedule=await db.pickupSchedule.findUnique({where:{weekday:weekdayFor(day)}});
  if(!schedule)return {date:day,slots:[],message:'Pickup hours are not configured for this day.'};
  const taken=await db.order.findMany({where:{pickupDate:day,status:{not:'CANCELLED'}},select:{pickupTime:true}});
  const counts=new Map<string,number>();for(const o of taken)if(o.pickupTime)counts.set(o.pickupTime,(counts.get(o.pickupTime)||0)+1);
  return {date:day,slots:pickupSlots(day,schedule,counts)};
 }
 if(path==='session'){const s=await currentSession();return {user:s?safeUser(s.user):null,verified:!!s?.verified,needsEnrollment:!!s&&isOperations(s.user.role)&&!s.user.totpEnabled};}
 const u=await requireUser();
 if(path==='orders'){const orders=await db.order.findMany({where:u.role==='CUSTOMER'?{userId:u.id}:{},orderBy:{createdAt:'desc'},take:200});return {orders:u.role==='CUSTOMER'?orders.map(({payments,...order})=>order):orders};}
 if(path==='pickup/schedule'){await requireUser(['ADMIN']);return {schedule:await db.pickupSchedule.findMany({orderBy:{weekday:'asc'}})};}
 if(path==='orders/prep'){await requireUser(ops);return {orders:await db.order.findMany({where:{status:{in:['PENDING','ACCEPTED','PREPARING','READY']}},orderBy:{createdAt:'desc'},take:200})};}
 if(path==='notifications')return {notifications:await db.notification.findMany({where:{userId:u.id},orderBy:{createdAt:'desc'},take:30})};
 if(path==='bookings')return {bookings:await db.booking.findMany({where:u.role==='CUSTOMER'?{userId:u.id}:{},include:{allocations:{include:{asset:true}}},orderBy:{eventDate:'desc'},take:200})};
 if(path==='assets'){await requireUser(ops);return {assets:await db.asset.findMany({include:{allocations:{where:{returned:false},include:{booking:{select:{eventDate:true,status:true,name:true}}}}},orderBy:{name:'asc'}})};}
 if(path==='users'){await requireUser(['ADMIN']);return {users:await db.user.findMany({select:{id:true,name:true,email:true,role:true,active:true,totpEnabled:true},orderBy:{createdAt:'desc'}})};}
 if(path==='blocks'){await requireUser(['ADMIN']);return {blocks:await db.blockedDate.findMany({orderBy:{date:'asc'}})};}
 if(path==='analytics'){
  await requireUser(['ADMIN']);
  const days=Number(req.nextUrl.searchParams.get('days')||30);
  if(![7,30,90].includes(days))fail(400,'Choose a 7, 30, or 90 day period.');
  const now=new Date(),window=analyticsWindow(days,now);
  const [orders,previousOrders,bookings,products,upcomingBookings,pendingRentalRequests]=await Promise.all([
   db.order.findMany({where:{createdAt:{gte:window.start,lte:now}},select:{status:true,total:true,paid:true,channel:true,createdAt:true,items:true}}),
   db.order.findMany({where:{createdAt:{gte:window.previousStart,lt:window.start},status:'COMPLETED'},select:{status:true,total:true,paid:true,channel:true,createdAt:true,items:true}}),
   db.booking.findMany({where:{eventDate:{gte:window.startDate,lte:window.endDate}},select:{status:true,total:true,paid:true,eventDate:true}}),
   db.product.findMany({select:{id:true,category:true}}),
   db.booking.count({where:{eventDate:{gte:window.endDate},status:{in:['CONFIRMED','PREPARING','READY','ONGOING']}}}),
   db.booking.count({where:{status:'PENDING'}})
  ]);
  return {...summarizeAnalytics({orders,previousOrders,bookings,products,days,now}),upcomingBookings,pendingRentalRequests};
 }
 fail(404,'Page not found.');
}
async function write(path:string,b:unknown){
 if(path==='auth/setup'){
  const token=process.env.ADMIN_SETUP_TOKEN;
  if(!token||token.length<32)fail(404,'Admin setup is unavailable.');
  const d=z.object({name,email,password,setupCode:z.string().min(1).max(256)}).parse(b);
  await rateLimit('admin-setup',8);
  const expected=crypto.createHash('sha256').update(token).digest();
  const supplied=crypto.createHash('sha256').update(d.setupCode).digest();
  if(!crypto.timingSafeEqual(expected,supplied))fail(401,'Setup code is incorrect.');
  const passwordHash=await bcrypt.hash(d.password,12);
  const user=await db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(4477103)`;
   if(await tx.user.count({where:{role:'ADMIN'}}))fail(409,'The first Admin account has already been created.');
   if(await tx.user.findUnique({where:{email:d.email}}))fail(409,'This email already has an account.');
   return tx.user.create({data:{name:d.name,email:d.email,passwordHash,role:'ADMIN'}});
  });
  await newSession(user.id,false);
  return {user:safeUser(user),verified:false,needsEnrollment:true};
 }
 if(path==='auth/register'){const d=z.object({name,email,password}).parse(b);await rateLimit('register:'+d.email,4);if(await db.user.findUnique({where:{email:d.email}}))fail(400,'Unable to create this account. Try signing in.');const user=await db.user.create({data:{name:d.name,email:d.email,passwordHash:await bcrypt.hash(d.password,12),role:'CUSTOMER'}});await newSession(user.id,true);return {user:safeUser(user),verified:true};}
 if(path==='auth/forgot'){
  if(!recoveryReady())fail(503,'Password recovery is not available yet. Please contact the shop.');
  const d=z.object({email}).parse(b);await rateLimit('password-reset:'+d.email,3,3600);
  const user=await db.user.findUnique({where:{email:d.email}});
  if(user?.active&&user.role==='CUSTOMER'){
   const token=crypto.randomBytes(32).toString('base64url'),tokenId=hash(token);
   await db.passwordResetToken.deleteMany({where:{userId:user.id}});
   await db.passwordResetToken.create({data:{id:tokenId,userId:user.id,expiresAt:new Date(Date.now()+30*60*1000)}});
   try{await sendPasswordReset(user.email,token)}catch(e){await db.passwordResetToken.deleteMany({where:{id:tokenId}});console.error('Password recovery delivery failed:',e instanceof Error?e.message:'Unknown error');}
  }
  return {ok:true,message:'If this is an active customer account, a reset link will arrive by email.'};
 }
 if(path==='auth/reset'){
  const d=z.object({token:z.string().min(40).max(100),password}).parse(b);await rateLimit('password-token:'+hash(d.token),8,3600);
  const passwordHash=await bcrypt.hash(d.password,12);
  await db.$transaction(async tx=>{
   const row=await tx.passwordResetToken.findUnique({where:{id:hash(d.token)},include:{user:true}});
   if(!row||row.expiresAt<=new Date()||!row.user.active||row.user.role!=='CUSTOMER')fail(400,'This reset link is invalid or expired. Request a new one.');
   const used=await tx.passwordResetToken.deleteMany({where:{id:row.id,expiresAt:{gt:new Date()}}});
   if(used.count!==1)fail(400,'This reset link is invalid or expired. Request a new one.');
   await tx.passwordResetToken.deleteMany({where:{userId:row.userId}});
   await tx.user.update({where:{id:row.userId},data:{passwordHash}});
   await tx.session.deleteMany({where:{userId:row.userId}});
   await tx.audit.create({data:{actor:row.userId,action:'CUSTOMER_PASSWORD_RESET',target:row.userId}});
  });
  (await cookies()).delete('cultiva_session');return {ok:true};
 }
 if(path==='auth/login'){const d=z.object({email,password:z.string().max(128)}).parse(b);await rateLimit('login:'+d.email,8);const u=await db.user.findUnique({where:{email:d.email}});const ok=await bcrypt.compare(d.password,u?.passwordHash||'$2b$12$QljzXhwj0fBFcz0.xThPoOlKA.eYN/XIfSSSLGkG.c2Om7oaUMPRG');if(!u||!u.active||!ok)fail(401,'Email or password is incorrect.');await newSession(u.id,!isOperations(u.role));return {user:safeUser(u),verified:!isOperations(u.role),needsEnrollment:isOperations(u.role)&&!u.totpEnabled};}
 if(path==='auth/logout'){const s=await currentSession();if(s)await db.session.deleteMany({where:{id:s.id}});(await cookies()).delete('cultiva_session');return {ok:true};}
 if(path==='auth/enroll'){const s=await currentSession();if(!s||!isOperations(s.user.role)||s.user.totpEnabled)fail(403,'Authenticator setup is not available.');const secret=s.user.totpSecret?decrypt(s.user.totpSecret):newTotp();if(!s.user.totpSecret)await db.user.update({where:{id:s.userId},data:{totpSecret:encrypt(secret)}});return {qr:await QRCode.toDataURL(makeTotp(secret,s.user.email).toString()),secret};}
 if(path==='auth/verify'){const d=z.object({code:z.string().trim().max(30),recovery:z.boolean().optional()}).parse(b);const s=await currentSession();if(!s||!isOperations(s.user.role)||!s.user.totpSecret)fail(401,'Please sign in again.');await rateLimit('totp:'+s.userId,8);let codes:string[]|undefined;
 await db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${s.userId}))`;const u=await tx.user.findUniqueOrThrow({where:{id:s.userId}});if(d.recovery){if(!u.totpEnabled||!u.recoveryHashes.includes(hash(d.code)))fail(401,'Invalid or previously used recovery code.');await tx.user.update({where:{id:u.id},data:{recoveryHashes:u.recoveryHashes.filter(x=>x!==hash(d.code))}});}else{const step=verifyTotp(decrypt(u.totpSecret!),u.email,d.code,u.lastTotpStep);if(step===null)fail(401,'Invalid or already used code. Wait for a new code and try again.');if(!u.totpEnabled)codes=recoveryCodes();await tx.user.update({where:{id:u.id},data:{totpEnabled:true,lastTotpStep:step,...(codes?{recoveryHashes:codes.map(hash)}:{})}});}});await newSession(s.userId,true);return {user:safeUser(s.user),verified:true,recoveryCodes:codes};}
 const u=await requireUser();
 if(path==='notifications/read'){const d=z.object({id}).parse(b);await db.notification.updateMany({where:{id:d.id,userId:u.id,readAt:null},data:{readAt:new Date()}});return {ok:true};}
 if(path==='profile'){const d=z.object({name,password:z.string().optional(),currentPassword:z.string().max(128)}).parse(b);if(!await bcrypt.compare(d.currentPassword,u.passwordHash))fail(400,'Current password is incorrect.');const newPassword=d.password?password.parse(d.password):undefined;await db.user.update({where:{id:u.id},data:{name:d.name,...(newPassword?{passwordHash:await bcrypt.hash(newPassword,12)}:{})}});if(newPassword){const s=await currentSession();await db.session.deleteMany({where:{userId:u.id,id:{not:s!.id}}});}return {ok:true};}
 if(path==='pickup/schedule/save'){
  await requireUser(['ADMIN']);
  const d=z.object({weekday:z.number().int().min(0).max(6),enabled:z.boolean(),opensAt:z.string().regex(/^([01]\d|2[0-3]):(00|30)$/),closesAt:z.string().regex(/^([01]\d|2[0-3]):(00|30)$/),capacity:z.number().int().min(1).max(50)}).parse(b);
  if(d.opensAt>=d.closesAt)fail(400,'Closing time must be after opening time.');
  await db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'schedule:'+d.weekday}))`;
   const existing=await tx.order.findMany({where:{pickupDate:{gte:todayManila()},pickupTime:{not:null},status:{not:'CANCELLED'}},select:{pickupDate:true,pickupTime:true}});
   const schedule={...d},valid=new Set(slotTimes(schedule)),counts=new Map<string,number>();
   for(const order of existing)if(order.pickupDate&&order.pickupTime&&weekdayFor(order.pickupDate)===d.weekday){
    if(!valid.has(order.pickupTime))fail(409,'Existing orders use this pickup time. Complete them before closing it.');
    const key=order.pickupDate+':'+order.pickupTime;counts.set(key,(counts.get(key)||0)+1);
    if((counts.get(key)||0)>d.capacity)fail(409,'Existing orders exceed this capacity. Choose a higher limit.');
   }
   await tx.pickupSchedule.upsert({where:{weekday:d.weekday},create:d,update:d});
   await tx.audit.create({data:{actor:u.id,action:'PICKUP_SCHEDULE_UPDATED',target:String(d.weekday)}});
  });
  return {ok:true};
 }
 if(path==='orders/create'){
  const d=z.object({items:z.array(z.object({id,qty:z.number().int().min(1).max(30)})).min(1).max(50),customerName:name.optional(),pos:z.boolean().optional(),pickupDate:z.string().optional(),pickupTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional()}).parse(b);
  if(d.pos)await requireUser(ops);
  if(!d.pos&&(!d.pickupDate||!d.pickupTime||!pickupWindow(d.pickupDate)))fail(400,'Choose an available pickup date and time within the next 14 days.');
  const products=await db.product.findMany({where:{id:{in:d.items.map(i=>i.id)},available:true}});
  const items=d.items.map(i=>{const p=products.find(p=>p.id===i.id);if(!p)fail(400,'An item is no longer available. Please update your cart.');return {id:p.id,name:p.name,category:p.category,price:p.price,qty:i.qty}});
  const total=items.reduce((s,i)=>s+i.price*i.qty,0);
  const order=await db.$transaction(async tx=>{
   if(!d.pos){
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'schedule:'+weekdayFor(d.pickupDate!)}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'pickup:'+d.pickupDate+':'+d.pickupTime}))`;
    const schedule=await tx.pickupSchedule.findUnique({where:{weekday:weekdayFor(d.pickupDate!)}});
    if(!schedule)fail(409,'Pickup hours are unavailable. Choose another day.');
    const taken=await tx.order.count({where:{pickupDate:d.pickupDate,pickupTime:d.pickupTime,status:{not:'CANCELLED'}}});
    const slot=pickupSlots(d.pickupDate!,schedule,new Map<string,number>([[d.pickupTime!,taken]])).find(s=>s.time===d.pickupTime);
    if(!slot?.available)fail(409,'This pickup slot is full or no longer available. Choose another time.');
   }
   const created=await tx.order.create({data:{userId:d.pos?null:u.id,customerName:d.pos?d.customerName||'Walk-in customer':u.name,channel:d.pos?'POS':'PICKUP',items,total,status:d.pos?'ACCEPTED':'PENDING',pickupDate:d.pos?null:d.pickupDate,pickupTime:d.pos?null:d.pickupTime}});
   if(!d.pos){
    await tx.notification.create({data:{userId:u.id,title:'Pickup order received',message:`Order #${created.id.slice(-6).toUpperCase()} is scheduled for ${d.pickupDate} at ${d.pickupTime}. Track it in My Orders.`}});
    const team=await tx.user.findMany({where:{role:{in:ops},active:true},select:{id:true}});
    if(team.length)await tx.notification.createMany({data:team.map(member=>({userId:member.id,title:'New pickup order',message:`Pickup for ${d.pickupDate} at ${d.pickupTime} · ${u.name} · Order #${created.id.slice(-6).toUpperCase()}.`}))});
   }
   await tx.audit.create({data:{actor:u.id,action:d.pos?'POS_ORDER_CREATED':'PICKUP_ORDER_CREATED',target:created.id}});
   return created;
  });
  if(!d.pos)await emailUpdate(u.id,'CULTIVA pickup order received',`Your order #${order.id.slice(-6).toUpperCase()} is scheduled for ${d.pickupDate} at ${d.pickupTime}. You can follow its progress in My Orders.`);
  return {order};
 }
 if(path==='orders/status'){await requireUser(ops);const d=z.object({id,status:z.string()}).parse(b);const o=await db.order.findUniqueOrThrow({where:{id:d.id}});if(!canTransition(orderTransitions,o.status,d.status))fail(400,'Invalid order status change.');if(d.status==='COMPLETED'&&o.paid<o.total)fail(400,'Record full payment before completing this order.');if(d.status==='CANCELLED'&&o.paid>0)fail(400,'Refund the recorded payment before cancellation.');await db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${d.id}))`;const current=await tx.order.findUniqueOrThrow({where:{id:d.id}});if(current.status!==o.status)fail(409,'Order changed. Please refresh.');if(d.status==='COMPLETED'&&current.paid<current.total)fail(400,'Record full payment before completing this order.');if(d.status==='CANCELLED'&&current.paid>0)fail(400,'Refund the recorded payment before cancellation.');await tx.order.update({where:{id:d.id},data:{status:d.status}});if(current.userId)await tx.notification.create({data:{userId:current.userId,title:'Pickup order updated',message:`Order #${current.id.slice(-6).toUpperCase()} is now ${d.status.toLowerCase()}. ${d.status==='READY'?'You can pick it up now.':''}`}});await tx.audit.create({data:{actor:u.id,action:'ORDER_'+d.status,target:d.id}})});if(o.userId)await emailUpdate(o.userId,'CULTIVA order update',`Your pickup order #${o.id.slice(-6).toUpperCase()} is now ${d.status.toLowerCase()}. ${d.status==='READY'?'You can pick it up now.':''}`);return {ok:true};}
 if(path==='orders/payment'){await requireUser(ops);const d=z.object({id,amount:money,method:z.enum(['Cash','GCash','Bank transfer']),reference:z.string().trim().min(2).max(100),refund:z.boolean().optional()}).parse(b);if(!d.amount)fail(400,'Enter a positive payment amount.');if(d.refund)await requireUser(['ADMIN']);await db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${d.id}))`;const o=await tx.order.findUniqueOrThrow({where:{id:d.id}});if(o.status==='CANCELLED')fail(400,'This order is cancelled.');const paid=o.paid+(d.refund?-d.amount:d.amount);if(paid<0||paid>o.total)fail(400,'Payment exceeds the outstanding balance or refund exceeds collections.');const payments=o.payments as Prisma.JsonArray;await tx.order.update({where:{id:d.id},data:{paid,paymentMethod:d.method,payments:[...payments,{amount:d.refund?-d.amount:d.amount,method:d.method,reference:d.reference,at:new Date().toISOString(),by:u.name,actorId:u.id}]}});await tx.audit.create({data:{actor:u.id,action:d.refund?'ORDER_REFUND':'ORDER_PAYMENT',target:d.id+':'+d.amount+':'+d.reference}});});return {ok:true};}
 if(path==='bookings/create'){const d=z.object({packageId:id,eventDate:date,eventTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),eventType:z.string().min(2).max(80),venue:z.string().trim().min(10).max(500),name,phone:z.string().regex(/^09\d{9}$/,'Use an 11-digit Philippine mobile number starting with 09.'),guests:z.number().int().min(1).max(1000),notes:z.string().max(1000).optional()}).parse(b);const result=await db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(921773)`;const p=await tx.package.findUniqueOrThrow({where:{id:d.packageId}});if(!p.active)fail(400,'Package is unavailable.');if(d.guests>p.servings)fail(400,'Choose a package with enough servings for your guests.');if(new Date(d.eventDate+'T'+d.eventTime+':00+08:00').getTime()<Date.now())fail(400,'Choose a future event time.');if(await tx.blockedDate.findUnique({where:{date:d.eventDate}})||await tx.booking.findFirst({where:{eventDate:d.eventDate,status:{in:reservedStatuses}}}))fail(409,'This date is no longer available. Choose another date.');if(await tx.booking.findFirst({where:{userId:u.id,eventDate:d.eventDate,status:'PENDING'}}))fail(409,'You already have a pending request for this date.');const {packageId,...data}=d;if(p.price+p.transportFee>100000000)fail(400,'Package total is too high.');const booking=await tx.booking.create({data:{...data,userId:u.id,packageName:p.name,packagePrice:p.price,transportFee:p.transportFee,total:p.price+p.transportFee}});await tx.notification.create({data:{userId:u.id,title:'Coffee cart request received',message:`Your request for ${d.eventDate} is under review. A verified deposit is required before confirmation.`,bookingId:booking.id}});const team=await tx.user.findMany({where:{role:{in:ops},active:true},select:{id:true}});if(team.length)await tx.notification.createMany({data:team.map(member=>({userId:member.id,title:'New coffee cart request',message:`${d.name} requested ${d.eventDate}. Review the reservation.`,bookingId:booking.id}))});await tx.audit.create({data:{actor:u.id,action:'BOOKING_REQUESTED',target:booking.id}});return {booking};});await emailUpdate(u.id,'CULTIVA coffee cart request received',`Your request for ${d.eventDate} has been received. Review the price breakdown and status in My Reservations.`);return result;}
 if(path==='bookings/status'){const d=z.object({id,status:z.string()}).parse(b);await db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(921773)`;const booking=await tx.booking.findUniqueOrThrow({where:{id:d.id}});if(u.role==='CUSTOMER'){if(booking.userId!==u.id||booking.status!=='PENDING'||d.status!=='CANCELLED')fail(403,'You can cancel only your own pending requests.');}else if(d.status==='CONFIRMED'||d.status==='CANCELLED'){if(u.role!=='ADMIN')fail(403,'Admin approval required.');}if(!canTransition(bookingTransitions,booking.status,d.status))fail(400,'Invalid booking status change.');if(d.status==='CONFIRMED'){if(booking.eventDate<todayManila())fail(400,'Past dates cannot be confirmed.');if(booking.paid<Math.ceil(booking.total/2))fail(400,'Verify at least a 50% deposit before confirmation.');if(await tx.blockedDate.findUnique({where:{date:booking.eventDate}})||await tx.booking.findFirst({where:{id:{not:d.id},eventDate:booking.eventDate,status:{in:reservedStatuses}}}))fail(409,'This date is already reserved or blocked.');}if(d.status==='COMPLETED'&&booking.paid<booking.total)fail(400,'Record full payment before completion.');if(d.status==='CANCELLED'&&booking.paid>0)fail(400,'Record a refund before cancellation.');if(['COMPLETED','CANCELLED'].includes(d.status)&&await tx.allocation.count({where:{bookingId:d.id,returned:false}}))fail(400,'Record equipment returns first.');await tx.booking.update({where:{id:d.id},data:{status:d.status}});if(u.role==='CUSTOMER'){const team=await tx.user.findMany({where:{role:{in:ops},active:true},select:{id:true}});if(team.length)await tx.notification.createMany({data:team.map(member=>({userId:member.id,title:'Reservation cancelled',message:`${booking.name} cancelled the request for ${booking.eventDate}.`,bookingId:booking.id}))});}else await tx.notification.create({data:{userId:booking.userId,title:'Coffee cart reservation updated',message:`Your reservation for ${booking.eventDate} is now ${d.status.toLowerCase()}.`,bookingId:booking.id}});await tx.audit.create({data:{actor:u.id,action:'BOOKING_'+d.status,target:d.id}});});if(u.role!=='CUSTOMER'){const booking=await db.booking.findUnique({where:{id:d.id},select:{userId:true,eventDate:true}});if(booking)await emailUpdate(booking.userId,'CULTIVA cart reservation update',`Your coffee cart reservation for ${booking.eventDate} is now ${d.status.toLowerCase()}. See My Reservations for your quote and remaining balance.`)}return {ok:true};}
 if(path==='bookings/payment'){await requireUser(['ADMIN']);const d=z.object({id,amount:money,method:z.enum(['Cash','GCash','Bank transfer']),reference:z.string().trim().min(2).max(100),refund:z.boolean().optional()}).parse(b);if(!d.amount)fail(400,'Enter a positive payment amount.');await db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(921773)`;const bk=await tx.booking.findUniqueOrThrow({where:{id:d.id}});if(bk.status==='CANCELLED')fail(400,'Booking is cancelled.');const paid=bk.paid+(d.refund?-d.amount:d.amount);if(paid<0||paid>bk.total)fail(400,'Amount exceeds the remaining balance or refundable amount.');const payments=bk.payments as Prisma.JsonArray;await tx.booking.update({where:{id:d.id},data:{paid,payments:[...payments,{amount:d.refund?-d.amount:d.amount,method:d.method,reference:d.reference,at:new Date().toISOString(),by:u.id}]}});await tx.audit.create({data:{actor:u.id,action:d.refund?'BOOKING_REFUND':'BOOKING_PAYMENT',target:d.id+':'+d.amount}});});return {ok:true};}
 if(path==='assets/save'){await requireUser(['ADMIN']);const d=z.object({id:id.optional(),name,category:z.string().min(1).max(50),quantity:z.number().int().min(1).max(10000),damaged:z.number().int().min(0).optional(),lost:z.number().int().min(0).optional()}).parse(b);if(d.id){await db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${d.id!}))`;const a=await tx.asset.findUniqueOrThrow({where:{id:d.id}});const active=await tx.allocation.aggregate({where:{assetId:d.id,returned:false},_sum:{quantity:true}});if(d.quantity<(d.damaged??a.damaged)+(d.lost??a.lost)+(active._sum.quantity||0))fail(400,'Quantity cannot be below damaged, lost, and outstanding assigned items.');await tx.asset.update({where:{id:d.id},data:{name:d.name,category:d.category,quantity:d.quantity,damaged:d.damaged??a.damaged,lost:d.lost??a.lost}});await tx.audit.create({data:{actor:u.id,action:'ASSET_ADJUST',target:`${d.id}:total=${d.quantity}:damaged=${d.damaged??a.damaged}:lost=${d.lost??a.lost}`}});});}else await db.asset.create({data:d});return {ok:true};}
 if(path==='assets/assign'){await requireUser(ops);const d=z.object({bookingId:id,assetId:id,quantity:z.number().int().min(1)}).parse(b);await db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(921773)`;await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${d.assetId}))`;const bk=await tx.booking.findUniqueOrThrow({where:{id:d.bookingId}});if(!['CONFIRMED','PREPARING','READY'].includes(bk.status))fail(400,'Assign equipment to a confirmed upcoming event.');const a=await tx.asset.findUniqueOrThrow({where:{id:d.assetId}});const assigned=await tx.allocation.aggregate({where:{assetId:d.assetId,returned:false},_sum:{quantity:true}});if(d.quantity>a.quantity-a.damaged-a.lost-(assigned._sum.quantity||0))fail(400,'Not enough unassigned usable items.');if(await tx.allocation.findUnique({where:{bookingId_assetId:{bookingId:d.bookingId,assetId:d.assetId}}}))fail(400,'This item is already assigned to this event.');await tx.allocation.create({data:d});});return {ok:true};}
 if(path==='assets/return'){await requireUser(ops);const d=z.object({id,damaged:z.number().int().min(0),lost:z.number().int().min(0)}).parse(b);await db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(921773)`;const a=await tx.allocation.findUniqueOrThrow({where:{id:d.id}});await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${a.assetId}))`;if(a.returned)fail(409,'Return already recorded.');if(d.damaged+d.lost>a.quantity)fail(400,'Return quantities exceed assigned items.');await tx.allocation.update({where:{id:d.id},data:{returned:true,damaged:d.damaged,lost:d.lost}});await tx.asset.update({where:{id:a.assetId},data:{damaged:{increment:d.damaged},lost:{increment:d.lost}}});await tx.audit.create({data:{actor:u.id,action:'ASSET_RETURN',target:d.id}});});return {ok:true};}
 if(path==='menu/save'){await requireUser(['ADMIN']);const d=z.object({id:id.optional(),name,description:z.string().max(400),category:z.enum(['Coffee','Non-coffee','Meals','Pastries']),price:money,image:z.string().regex(/^\/images\/[a-z-]+\.jpg$|^\/api\/menu\/image\/[a-z0-9-]+$/),available:z.boolean(),featured:z.boolean()}).parse(b);const product=d.id?await db.product.update({where:{id:d.id},data:d}):await db.product.create({data:d});return {ok:true,productId:product.id};}
 if(path==='packages/save'){await requireUser(['ADMIN']);const d=z.object({id,name,servings:z.number().int().min(1).max(1000),hours:z.number().int().min(1).max(12),price:money,transportFee:money.default(0),description:z.string().max(400),active:z.boolean()}).parse(b);await db.package.update({where:{id:d.id},data:d});return {ok:true};}
 if(path==='blocks/save'){await requireUser(['ADMIN']);const d=z.object({date,reason:z.string().min(2).max(200),remove:z.boolean().optional()}).parse(b);await db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(921773)`;if(d.remove){await tx.blockedDate.deleteMany({where:{date:d.date}});return;}if(await tx.booking.findFirst({where:{eventDate:d.date,status:{in:reservedStatuses}}}))fail(409,'This date already has a confirmed event.');await tx.blockedDate.upsert({where:{date:d.date},create:{date:d.date,reason:d.reason},update:{reason:d.reason}});});return {ok:true};}
 if(path==='users/create'){await requireUser(['ADMIN']);const d=z.object({name,email,password,role:z.enum(['STAFF','ADMIN'])}).parse(b);if(await db.user.findUnique({where:{email:d.email}}))fail(400,'This email already has an account.');await db.user.create({data:{name:d.name,email:d.email,role:d.role,passwordHash:await bcrypt.hash(d.password,12)}});await audit(u.id,'CREATE_'+d.role,d.email);return {ok:true};}
 if(path==='users/recover'){await requireUser(['ADMIN']);const d=z.object({id,currentPassword:z.string().max(128),resetAuthenticator:z.boolean()}).parse(b);await rateLimit('team-recovery:'+u.id,6);if(!await bcrypt.compare(d.currentPassword,u.passwordHash))fail(403,'Your password is incorrect.');if(d.id===u.id)fail(400,'Use your own recovery codes or account settings.');const target=await db.user.findUniqueOrThrow({where:{id:d.id}});if(target.role!=='STAFF'||!target.active)fail(403,'Only active Staff accounts can be recovered here.');const temporaryPassword=crypto.randomBytes(24).toString('base64url');await db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${d.id}))`;await tx.user.update({where:{id:d.id},data:{passwordHash:await bcrypt.hash(temporaryPassword,12),...(d.resetAuthenticator?{totpSecret:null,totpEnabled:false,lastTotpStep:0n,recoveryHashes:[]}:{})}});await tx.session.deleteMany({where:{userId:d.id}});await tx.audit.create({data:{actor:u.id,action:d.resetAuthenticator?'STAFF_CREDENTIALS_RECOVERED':'STAFF_PASSWORD_RESET',target:d.id}});});return {temporaryPassword};}
 if(path==='users/active'){await requireUser(['ADMIN']);const d=z.object({id,active:z.boolean()}).parse(b);if(d.id===u.id)fail(400,'You cannot deactivate your own account.');await db.user.update({where:{id:d.id},data:{active:d.active}});await db.session.deleteMany({where:{userId:d.id}});await audit(u.id,'USER_ACTIVE_'+d.active,d.id);return {ok:true};}
 fail(404,'Action not found.');
}
async function handle(req:NextRequest,context:{params:Promise<{path:string[]}>},post:boolean){try{const path=(await context.params).path.join('/');if(post){if(path==='menu/image'){await guardOrigin('multipart/form-data');await requireUser(['ADMIN']);if(Number(req.headers.get('content-length')||0)>2_000_000)fail(413,'Photo must be under 1 MB.');const form=await req.formData();const productId=id.parse(form.get('productId'));const file=form.get('photo');if(!(file instanceof File)||file.size<1||file.size>1_000_000)fail(400,'Choose a JPEG, PNG, or WebP photo under 1 MB.');const bytes=new Uint8Array(await file.arrayBuffer()),mime=file.type;const valid=mime==='image/jpeg'&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255||mime==='image/png'&&bytes.slice(0,8).every((x,i)=>x===[137,80,78,71,13,10,26,10][i])||mime==='image/webp'&&Buffer.from(bytes.slice(0,4)).toString()==='RIFF'&&Buffer.from(bytes.slice(8,12)).toString()==='WEBP';if(!valid)fail(400,'Choose a valid JPEG, PNG, or WebP photo.');await db.$transaction(async tx=>{await tx.product.findUniqueOrThrow({where:{id:productId}});await tx.productImage.upsert({where:{productId},create:{productId,bytes,mimeType:mime},update:{bytes,mimeType:mime}});await tx.product.update({where:{id:productId},data:{image:'/api/menu/image/'+productId}})});return json({ok:true});}await guardOrigin();if(Number(req.headers.get('content-length')||0)>50000)fail(413,'Request too large.');return json(await write(path,await req.json()));}const value=await read(path,req);return value instanceof NextResponse?value:json(value);}catch(e){if(e instanceof HttpError)return json({error:e.message},e.status);if(e instanceof z.ZodError)return json({error:e.issues[0]?.message||'Invalid information.'},400);if(e instanceof Prisma.PrismaClientKnownRequestError){if(e.code==='P2025')return json({error:'Record not found.'},404);if(e.code==='P2002')return json({error:'This record already exists.'},409);}console.error('Request failed:',e instanceof Error?e.name:'Unknown error');return json({error:'Unable to complete the request. Please try again.'},500);}}
export const GET=(r:NextRequest,c:{params:Promise<{path:string[]}>})=>handle(r,c,false);
export const POST=(r:NextRequest,c:{params:Promise<{path:string[]}>})=>handle(r,c,true);
