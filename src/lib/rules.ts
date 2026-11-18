export const reservedStatuses = ['CONFIRMED','PREPARING','READY','ONGOING','COMPLETED'];
export const orderTransitions: Record<string,string[]> = {PENDING:['ACCEPTED','CANCELLED'],ACCEPTED:['PREPARING','CANCELLED'],PREPARING:['READY'],READY:['COMPLETED'],COMPLETED:[],CANCELLED:[]};
export const bookingTransitions: Record<string,string[]> = {PENDING:['CONFIRMED','CANCELLED'],CONFIRMED:['PREPARING','CANCELLED'],PREPARING:['READY'],READY:['ONGOING'],ONGOING:['COMPLETED'],COMPLETED:[],CANCELLED:[]};
export function todayManila(now=new Date()) { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(now); }
export function validDate(value:string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value; }
export function usableAsset(quantity:number, damaged:number, lost:number) { return quantity-damaged-lost; }
export function canTransition(map:Record<string,string[]>,from:string,to:string) { return !!map[from]?.includes(to); }
export function isOperations(role:string) { return role==='ADMIN'||role==='STAFF'; }
export const peso = (cents:number) => new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP',minimumFractionDigits:cents%100?2:0,maximumFractionDigits:2}).format(cents/100);
