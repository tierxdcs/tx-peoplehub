'use client';
import { FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { useQmsAccess } from '../../../lib/use-qms-access';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
type T={id:string;templateCode:string;name:string;templateType:string;version:number;status:string;questions:{id:string;prompt:string}[]};
type Q={section:string;prompt:string;responseType:string;required:boolean;unit:string;lowerLimit:string;upperLimit:string};
const blank=():Q=>({section:'General',prompt:'',responseType:'PASS_FAIL_NA',required:true,unit:'',lowerLimit:'',upperLimit:''});
const kinds=['PASS_FAIL_NA','YES_NO_NA','TEXT','NUMBER','MEASUREMENT','DATE','SINGLE_CHOICE','MULTIPLE_CHOICE','RATING','PHOTO','DOCUMENT','SIGNATURE'];
export default function Templates(){
 const{isQmsHead}=useQmsAccess(),[items,setItems]=useState<T[]>([]),[code,setCode]=useState(''),[name,setName]=useState(''),[type,setType]=useState('INCOMING'),[questions,setQuestions]=useState<Q[]>([blank()]);
 const load=()=>apiFetch<T[]>('/qms/templates').then(setItems); useEffect(()=>{load()},[]);
 const update=(i:number,p:Partial<Q>)=>setQuestions(questions.map((q,n)=>n===i?{...q,...p}:q));
 async function create(e:FormEvent){e.preventDefault();await apiFetch('/qms/templates',{method:'POST',body:JSON.stringify({templateCode:code,name,templateType:type,questions:questions.map((q,i)=>({...q,sequence:i+1,weight:1,unit:q.unit||undefined,lowerLimit:q.lowerLimit?Number(q.lowerLimit):undefined,upperLimit:q.upperLimit?Number(q.upperLimit):undefined}))})});setCode('');setName('');setQuestions([blank()]);await load();}
 async function action(id:string,a:string){await apiFetch(`/qms/templates/${id}/${a}`,{method:'POST',body:'{}'});await load();}
 return <PageContainer><PageHeader title="Question Templates" description="Versioned reusable checklists for inspections and audits"/>
  <Card className="mb-6"><CardContent className="p-5"><form className="grid gap-4" onSubmit={create}><div className="grid gap-3 md:grid-cols-3"><Input required value={code} onChange={e=>setCode(e.target.value)} placeholder="Template code"/><Input required value={name} onChange={e=>setName(e.target.value)} placeholder="Template name"/><Select value={type} onChange={e=>setType(e.target.value)}>{['INCOMING','IN_PROCESS','FINAL','FAT','PRE_DISPATCH','INTERNAL_AUDIT','PROCESS_AUDIT','SUPPLIER_AUDIT','PRODUCT_AUDIT','FIVE_S','CUSTOM'].map(x=><option key={x}>{x}</option>)}</Select></div>
   {questions.map((q,i)=><div className="grid gap-2 rounded-md border p-3 md:grid-cols-6" key={i}><Input value={q.section} onChange={e=>update(i,{section:e.target.value})} placeholder="Section"/><Input className="md:col-span-2" required value={q.prompt} onChange={e=>update(i,{prompt:e.target.value})} placeholder={`Question ${i+1}`}/><Select value={q.responseType} onChange={e=>update(i,{responseType:e.target.value})}>{kinds.map(x=><option key={x}>{x}</option>)}</Select><Input value={q.unit} onChange={e=>update(i,{unit:e.target.value})} placeholder="Unit"/><Button type="button" variant="outline" onClick={()=>setQuestions(questions.filter((_,n)=>n!==i))} disabled={questions.length===1}>Remove</Button>{q.responseType==='MEASUREMENT'&&<><Input value={q.lowerLimit} onChange={e=>update(i,{lowerLimit:e.target.value})} placeholder="Lower limit"/><Input value={q.upperLimit} onChange={e=>update(i,{upperLimit:e.target.value})} placeholder="Upper limit"/></>}</div>)}
   <div className="flex gap-2"><Button type="button" variant="outline" onClick={()=>setQuestions([...questions,blank()])}>Add question</Button><Button type="submit">Create draft template</Button></div></form></CardContent></Card>
  <Card><CardContent className="p-5">{items.map(t=><div className="flex items-center justify-between border-b py-3 text-sm" key={t.id}><span><b>{t.templateCode} v{t.version}</b> · {t.name} · {t.templateType} · {t.status} · {t.questions.length} questions</span><div className="flex gap-2">{t.status==='DRAFT'&&<Button size="sm" onClick={()=>action(t.id,'submit')}>Submit</Button>}{isQmsHead&&t.status==='PENDING_APPROVAL'&&<Button size="sm" onClick={()=>action(t.id,'approve')}>Approve</Button>}{['APPROVED','RETIRED'].includes(t.status)&&<Button size="sm" variant="outline" onClick={()=>action(t.id,'revise')}>New version</Button>}</div></div>)}</CardContent></Card>
 </PageContainer>;
}
