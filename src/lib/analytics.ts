import {todayManila} from './rules';

export type SaleItem={id?:string,name:string,category?:string,qty:number,price:number};
export type SaleOrder={status:string,total:number,paid:number,channel:string,createdAt:Date,items:unknown};
export type RentalBooking={status:string,total:number,paid:number,eventDate:string};
export type CatalogItem={id:string,category:string};

function shiftDay(date:string,offset:number){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10)}
function dateLabel(date:string){return new Intl.DateTimeFormat('en-PH',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'))}

export function analyticsWindow(days:number,now=new Date()){
 const endDate=todayManila(now),startDate=shiftDay(endDate,1-days),previousStartDate=shiftDay(startDate,-days);
 return {startDate,endDate,previousStartDate,start:new Date(startDate+'T00:00:00+08:00'),previousStart:new Date(previousStartDate+'T00:00:00+08:00')};
}

export function summarizeAnalytics(input:{orders:SaleOrder[],previousOrders:SaleOrder[],bookings:RentalBooking[],products:CatalogItem[],days:number,now?:Date}){
 const {orders,previousOrders,bookings,products,days}=input;
 const now=input.now||new Date(),{startDate,endDate}=analyticsWindow(days,now);
 const valid=orders.filter(o=>o.status!=='CANCELLED'),completed=valid.filter(o=>o.status==='COMPLETED');
 const sales=completed.reduce((sum,o)=>sum+o.total,0);
 const previousSales=previousOrders.filter(o=>o.status==='COMPLETED').reduce((sum,o)=>sum+o.total,0);
 const catalog=new Map(products.map(p=>[p.id,p.category]));
 const ranked=new Map<string,{name:string,category:string,qty:number,total:number}>();
 const categories=new Map<string,{name:string,qty:number,total:number}>();
 const channelMap=new Map<string,{name:string,orders:number,total:number}>();
 const daily=new Map<string,{total:number,orders:number}>();
 const hourBins=Array.from({length:12},(_,i)=>({hour:i*2,orders:0}));
 for(const order of completed){
  const date=todayManila(order.createdAt),day=daily.get(date)||{total:0,orders:0};day.total+=order.total;day.orders++;daily.set(date,day);
  const channel=order.channel==='POS'?'Walk-in POS':'Pickup',c=channelMap.get(channel)||{name:channel,orders:0,total:0};c.orders++;c.total+=order.total;channelMap.set(channel,c);
  const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',hourCycle:'h23'}).format(order.createdAt));hourBins[Math.floor(hour/2)].orders++;
  for(const item of order.items as SaleItem[]){
   const category=item.category||catalog.get(item.id||'')||'Other',key=(item.id||item.name)+'|'+category;
   const product=ranked.get(key)||{name:item.name,category,qty:0,total:0};product.qty+=item.qty;product.total+=item.qty*item.price;ranked.set(key,product);
   const group=categories.get(category)||{name:category,qty:0,total:0};group.qty+=item.qty;group.total+=item.qty*item.price;categories.set(category,group);
  }
 }
 const periods=[];
 for(let i=0;i<days;i+=days===90?7:1){
  const first=shiftDay(startDate,i),last=shiftDay(startDate,Math.min(days-1,i+(days===90?6:0)));
  let total=0,count=0;for(let j=i;j<Math.min(days,i+(days===90?7:1));j++){const d=daily.get(shiftDay(startDate,j));total+=d?.total||0;count+=d?.orders||0}
  periods.push({label:days===90?dateLabel(first)+'–'+dateLabel(last):dateLabel(first),start:first,end:last,total,orders:count});
 }
 const byUnits=(a:{qty:number,total:number},b:{qty:number,total:number})=>b.qty-a.qty||b.total-a.total;
 const productsRanked=[...ranked.values()];
 const categoryTotals=[...categories.values()].sort((a,b)=>b.total-a.total);
 const channels=[...channelMap.values()].sort((a,b)=>b.total-a.total);
 const peakHour=hourBins.reduce<{hour:number,orders:number}|null>((best,p)=>p.orders>(best?.orders||0)?p:best,null);
 const rental=bookings.filter(b=>b.status==='COMPLETED');
 return {days,startDate,endDate,sales,previousSales,salesChangePercent:previousSales?Math.round((sales-previousSales)/previousSales*100):null,
  completedOrders:completed.length,orders:valid.length,activeOrders:valid.filter(o=>!['COMPLETED'].includes(o.status)).length,
  averageOrder:completed.length?Math.round(sales/completed.length):0,
  rentalRevenue:rental.reduce((sum,b)=>sum+b.total,0),bookings:bookings.filter(b=>b.status!=='CANCELLED').length,
  collections:orders.reduce((sum,o)=>sum+o.paid,0)+bookings.reduce((sum,b)=>sum+b.paid,0),
  outstanding:valid.reduce((sum,o)=>sum+o.total-o.paid,0)+bookings.filter(b=>b.status!=='CANCELLED').reduce((sum,b)=>sum+b.total-b.paid,0),
  topCoffee:productsRanked.filter(p=>p.category==='Coffee').sort(byUnits).slice(0,5),
  topMeals:productsRanked.filter(p=>p.category==='Meals').sort(byUnits).slice(0,5),
  categoryTotals,channels,peakHour,hourBins,chart:periods};
}
