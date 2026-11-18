import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'CULTIVA — Coffee, food & good company',description:'Your everyday coffee ritual, and a coffee cart for your next celebration.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
