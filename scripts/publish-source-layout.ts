/** Publish the reviewed source manifest to a NEW demo venture; never overwrite existing bookings. */
import {readFile} from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {createPostgresDatabase} from "../src/lib/db/postgres";
import {writeAudit} from "../src/lib/audit";
import layout from "../src/lib/inventory/layouts/sphoorthy-green-nest.json";
const arg=(n:string)=>{const i=process.argv.indexOf(n);return i<0?undefined:process.argv[i+1];};
async function main(){
 if(!process.argv.includes("--yes-i-am-sure"))throw new Error("Explicit publication flag required.");
 const pdfPath=arg("--pdf"),imagePath=arg("--image");if(!pdfPath||!imagePath)throw new Error("PDF and extracted reference image required.");
 const pdf=await readFile(pdfPath),image=await readFile(imagePath);
 if(createHash("sha256").update(pdf).digest("hex")!==layout.sha256)throw new Error("PDF does not match the reviewed manifest.");
 if(layout.plots.length!==279||new Set(layout.plots.map(p=>p.plot_number)).size!==279)throw new Error("Invalid manifest count.");
 if(!process.env.POSTGRES_URL_NON_POOLING||!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw new Error("Production connections missing.");
 const db=createPostgresDatabase(process.env.POSTGRES_URL_NON_POOLING);
 try{
  const [org]=await db.query<{organization_id:string}>("select organization_id from ventures where code='SUNRISE-DEMO' and is_demo=true");if(!org)throw new Error("Expected demo organization not found.");
  const [existing]=await db.query<{id:string}>("select id from ventures where organization_id=$1 and code=$2",[org.organization_id,layout.code]);
  if(existing){const [{n}]=await db.query<{n:number}>("select count(*)::int as n from plots where venture_id=$1",[existing.id]);if(n!==279)throw new Error("Existing venture differs; manual review required.");console.log(JSON.stringify({status:"already-published",ventureId:existing.id,plots:n}));return;}
  const id=randomUUID(),sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
  const bucket="venture-assets";const {data:info,error}=await sb.storage.getBucket(bucket);if(error||!info||info.public)throw new Error("Expected private asset bucket.");
  const pdfPathStored=`${org.organization_id}/ventures/${id}/layout_pdf/${randomUUID()}.pdf`,imagePathStored=`${org.organization_id}/ventures/${id}/image/${randomUUID()}.jpg`;
  for(const [path,data,contentType]of [[pdfPathStored,pdf,"application/pdf"],[imagePathStored,image,"image/jpeg"]] as const){const r=await sb.storage.from(bucket).upload(path,data,{contentType,upsert:false});if(r.error)throw new Error("Asset upload failed.");}
  await db.transaction(async tx=>{
   await tx.query(`insert into ventures(id,organization_id,name,code,slug,description,location_text,city,state,survey_numbers,approval_authority,approval_reference,total_land_area,declared_total_plots,roads_description,amenities,status,is_published,is_demo,viewer_settings)
    values($1,$2,$3,$4,$5,$6,$7,$8,'Telangana','526/P, 527','DTCP','TLP No. 04/2022/H',18.75,279,$9,$10,'launched',true,true,$11::jsonb)`,
    [id,org.organization_id,"Sphoorthy Green Nest — PDF Demo",layout.code,"sphoorthy-green-nest-layout-demo",`Source: ${layout.source_file}. Printed plot data and approximate image-traced navigation overlay. Unreadable boundaries need survey confirmation. The document's approval claims are not independently verified. No selling rate is supplied.`,"Sharbhanapuram, Kollur Revenue Village, Alair Mandal, Yadadri Bhuvanagiri","Yadadri Bhuvanagiri","40 ft and 33 ft roads shown in source",["Parks","Street lights","Underground drainage","Water tank","Avenue plantation"],{referenceLayout:{width:layout.image_width,height:layout.image_height,unitsPerPixel:.2},showLabels:false,introAnimation:false,defaultMode:"top",autoTransition:false}]);
   const [pdfAsset]=await tx.query<{id:string}>("insert into venture_assets(organization_id,venture_id,kind,storage_driver,storage_path,file_name,mime_type,size_bytes) values($1,$2,'layout_pdf','supabase',$3,$4,'application/pdf',$5) returning id",[org.organization_id,id,pdfPathStored,layout.source_file,pdf.length]);
   const [imageAsset]=await tx.query<{id:string}>("insert into venture_assets(organization_id,venture_id,kind,storage_driver,storage_path,file_name,mime_type,size_bytes) values($1,$2,'image','supabase',$3,'sphoorthy-green-nest-source-layout.jpg','image/jpeg',$4) returning id",[org.organization_id,id,imagePathStored,image.length]);
   await tx.query("update ventures set cover_image_asset_id=$2,layout_pdf_asset_id=$3 where id=$1",[id,imageAsset.id,pdfAsset.id]);
   for(const p of layout.plots){
    const reason=p.mortgaged?"Mortgage-marked plot in source PDF. Release and price verification required.":"Source PDF has no selling price. Configure a verified price before unblocking.";
    const ft=(n:number|null)=>n===null?"Unconfirmed":`${Math.round(n*100)/100} ft`;
    const dimensions=`N: ${ft(p.north_ft)}; S: ${ft(p.south_ft)}; E: ${ft(p.east_ft)}; W: ${ft(p.west_ft)}`;
    const [plot]=await tx.query<{id:string}>(`insert into plots(organization_id,venture_id,plot_number,area_sq_yards,length_ft,width_ft,dimensions_text,facing,road_width_ft,is_corner,base_price_per_sq_yard,status,blocked_reason,north_ft,south_ft,east_ft,west_ft,source_metadata,notes)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,'blocked',$11,$12,$13,$14,$15,$16::jsonb,$17) returning id`,[org.organization_id,id,p.plot_number,p.area_sq_yards,p.dimensions_verified?p.north_ft:null,p.dimensions_verified?p.east_ft:null,dimensions,p.facing,p.road_width_ft,p.is_corner,reason,p.north_ft,p.south_ft,p.east_ft,p.west_ft,{source_file:layout.source_file,source_sha256:layout.sha256,printed_area:true,mortgaged:p.mortgaged,dimensions_verified:p.dimensions_verified,geometry:"image-traced navigation overlay, not surveyed boundaries"},"Imported from scanned layout; areas are printed labels. Unknown boundary sides are unconfirmed; no price was inferred."]);
    await tx.query("update plots set is_mortgaged=$2 where id=$1",[plot.id,p.mortgaged]);
    const polygon=p.polygon_px.map(([x,y])=>[Math.round(x*.2*1000)/1000,Math.round(-y*.2*1000)/1000]);
    await tx.query("insert into plot_geometry(organization_id,venture_id,plot_id,mesh_id,polygon,centroid_x,centroid_y,source) values($1,$2,$3,$4,$5::jsonb,$6,$7,'manual')",[org.organization_id,id,plot.id,`plot_${p.plot_number}`,JSON.stringify(polygon),polygon.reduce((n,a)=>n+a[0],0)/polygon.length,polygon.reduce((n,a)=>n+a[1],0)/polygon.length]);
    await tx.query("insert into plot_status_history(organization_id,plot_id,from_status,to_status,reason) values($1,$2,null,'blocked',$3)",[org.organization_id,plot.id,reason]);
   }
   await writeAudit(tx,{system:true,organizationId:org.organization_id},{action:"venture.layout_published",entityType:"venture",entityId:id,summary:"Published reviewed Sphoorthy PDF layout with 279 plots",metadata:{source_file:layout.source_file,sha256:layout.sha256,plots:279,mortgage_marked:35,price_supplied:false,geometry:layout.geometry,printed_area_sum:layout.printed_plot_area_sum_sq_yards,statement_area:layout.declared_plotted_area_sq_yards}});
  });
  for(const [path,bytes]of [[pdfPathStored,pdf],[imagePathStored,image]] as const){const r=await sb.storage.from(bucket).download(path);if(!r.data||createHash("sha256").update(Buffer.from(await r.data.arrayBuffer())).digest("hex")!==createHash("sha256").update(bytes).digest("hex"))throw new Error("Uploaded source verification failed.");}
  console.log(JSON.stringify({status:"published",ventureId:id,plots:279,mortgagePlots:35,bookable:false,sourceVerified:true}));
 }finally{await db.close();}
}
main().catch(e=>{console.error(e instanceof Error?e.message:"Source layout publication failed.");process.exitCode=1;});
