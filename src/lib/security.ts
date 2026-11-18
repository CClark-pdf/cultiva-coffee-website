import crypto from 'node:crypto';
import * as OTPAuth from 'otpauth';
export const hash = (text:string) => crypto.createHash('sha256').update(text).digest('hex');
function key() {const v=process.env.AUTH_ENCRYPTION_KEY;if(!v||!/^[a-f0-9]{64}$/i.test(v))throw new Error('AUTH_ENCRYPTION_KEY must contain 64 hexadecimal characters');return Buffer.from(v,'hex');}
export function encrypt(value:string) {const iv=crypto.randomBytes(12);const cipher=crypto.createCipheriv('aes-256-gcm',key(),iv);const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64');}
export function decrypt(value:string) {const b=Buffer.from(value,'base64');const decipher=crypto.createDecipheriv('aes-256-gcm',key(),b.subarray(0,12));decipher.setAuthTag(b.subarray(12,28));return Buffer.concat([decipher.update(b.subarray(28)),decipher.final()]).toString('utf8');}
export function makeTotp(secret:string,email:string) {return new OTPAuth.TOTP({issuer:'CULTIVA',label:email,algorithm:'SHA1',digits:6,period:30,secret:OTPAuth.Secret.fromBase32(secret)});}
export function verifyTotp(secret:string,email:string,code:string,lastStep:bigint,now=Date.now()) {if(!/^\d{6}$/.test(code))return null;const delta=makeTotp(secret,email).validate({token:code,window:1,timestamp:now});if(delta===null)return null;const step=BigInt(Math.floor(now/30000)+delta);return step>lastStep?step:null;}
export function newTotp() {return new OTPAuth.Secret({size:20}).base32;}
export function recoveryCodes() {return Array.from({length:8},()=>crypto.randomBytes(6).toString('hex'));}
