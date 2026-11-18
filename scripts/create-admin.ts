import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
const email=z.email().parse(process.env.ADMIN_EMAIL?.toLowerCase());
const password=z.string().min(12).max(128).parse(process.env.ADMIN_PASSWORD);
const db=new PrismaClient();
if(await db.user.findUnique({where:{email}}))throw new Error('Account already exists; no changes made.');
await db.user.create({data:{email,name:process.env.ADMIN_NAME||'Owner',passwordHash:await bcrypt.hash(password,12),role:'ADMIN'}});
console.log('Admin created. Google Authenticator enrollment is required at first sign-in.');await db.$disconnect();
