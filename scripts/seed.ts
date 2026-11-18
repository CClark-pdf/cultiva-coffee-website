import { PrismaClient } from '@prisma/client';
const db=new PrismaClient();
const products=[
 {id:'spanish-latte',name:'Spanish Latte',description:'Rich espresso, silky milk, a little sweetness.',category:'Coffee',price:15000,image:'/images/latte.jpg',featured:true},
 {id:'americano',name:'Classic Americano',description:'A clean, bold espresso. Served over ice.',category:'Coffee',price:11000,image:'/images/hero.jpg',featured:true},
 {id:'vanilla-latte',name:'Vanilla Latte',description:'Our espresso with creamy milk and vanilla.',category:'Coffee',price:15500,image:'/images/latte.jpg'},
 {id:'matcha',name:'Matcha Latte',description:'Earthy matcha whisked with fresh milk.',category:'Non-coffee',price:16500,image:'/images/matcha.jpg',featured:true},
 {id:'chocolate',name:'Iced Chocolate',description:'Comforting cocoa and milk, poured over ice.',category:'Non-coffee',price:14000,image:'/images/latte.jpg'},
 {id:'chicken',name:'Grilled Chicken Bowl',description:'Grilled chicken, steamed rice, and fresh sides.',category:'Meals',price:22500,image:'/images/meal.jpg',featured:true},
 {id:'breakfast',name:'All-day Breakfast',description:'A hearty plate for slow mornings and late lunches.',category:'Meals',price:24000,image:'/images/meal.jpg'},
 {id:'croissant',name:'Butter Croissant',description:'Golden, flaky layers. Your coffee’s perfect company.',category:'Pastries',price:9500,image:'/images/pastry.jpg',featured:true}
];
for(const p of products)await db.product.upsert({where:{id:p.id},create:p,update:{}});
for(const p of [
 {id:'intimate',name:'The Intimate',servings:50,hours:2,price:650000,description:'For birthdays, small celebrations, and your closest people.'},
 {id:'signature',name:'The Signature',servings:100,hours:3,price:1100000,description:'A full coffee experience for weddings and work gatherings.'},
 {id:'grand',name:'The Grand',servings:150,hours:4,price:1550000,description:'More cups, more time, and a celebration to remember.'}
])await db.package.upsert({where:{id:p.id},create:p,update:{}});
for(const a of [{id:'cups',name:'Reusable coffee cups',category:'Drinkware',quantity:100},{id:'glasses',name:'Glass tumblers',category:'Drinkware',quantity:100},{id:'pitchers',name:'Milk pitchers',category:'Equipment',quantity:8},{id:'trays',name:'Serving trays',category:'Service',quantity:12}])await db.asset.upsert({where:{id:a.id},create:a,update:{}});
console.log('Sample catalog, packages, and reusable items seeded. No sales or bookings fabricated.');await db.$disconnect();
