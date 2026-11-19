export function recoveryReady(){return !!(process.env.RESEND_API_KEY&&process.env.RESET_FROM_EMAIL&&(process.env.APP_URL?.startsWith('https://')||process.env.CULTIVA_ALLOW_LOCAL_EMAIL_TEST==='1'))}

export async function sendPasswordReset(to:string,token:string){
 if(!recoveryReady())throw new Error('Password recovery email is not configured.');
 const link=new URL('/reset-password',process.env.APP_URL!);link.searchParams.set('token',token);
 const response=await fetch(process.env.RESEND_API_URL||'https://api.resend.com/emails',{
  method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},
  body:JSON.stringify({from:process.env.RESET_FROM_EMAIL,to:[to],subject:'Reset your CULTIVA password',text:`You requested a password reset for your CULTIVA customer account. This link works once and expires in 30 minutes:\n\n${link.toString()}\n\nIf you did not request this, you can ignore this email.`})
 });
 if(!response.ok)throw new Error(`Email provider rejected the reset message (${response.status}).`);
}
