import { afterAll,beforeAll,describe,it,expect } from "vitest";
import { createClient,type SupabaseClient } from "@supabase/supabase-js";
import { createFixtureWorld,destroyFixtureWorld,insertRunQuestion,resolveTarget,sweepStaleRuns,type FixtureWorld } from "./live-fixture";
// Self-contained: every identity, class, node and question below is created for this run and removed afterwards.
describe.skipIf(process.env.QB_LIVE_ACCEPTANCE!=="1")("final live authorization gates",()=>{
 let world:FixtureWorld,student:SupabaseClient,seller:SupabaseClient,sponsor:SupabaseClient,teacher:SupabaseClient,admin:SupabaseClient,anon:SupabaseClient;
 let productionQuestion:string,fixtureQuestion:string;
 beforeAll(async()=>{
  sweepStaleRuns();
  world=await createFixtureWorld({roles:["admin","teacher","student","student2","seller","sponsor"]});
  [admin,teacher,student,seller,sponsor]=await Promise.all([world.client("admin"),world.client("teacher"),world.client("student"),world.client("seller"),world.client("sponsor")]);
  const target=resolveTarget();anon=createClient(target.url,target.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
  productionQuestion=insertRunQuestion(world,{sourceType:"QBRUN_FIXTURE",label:"PROD1"});
  fixtureQuestion=insertRunQuestion(world,{sourceType:"DEV_FACTORY_PILOT",label:"FIXT1"});
 },180000);
 afterAll(async()=>{if(world)await destroyFixtureWorld(world);},120000);
 const invalid="00000000-0000-0000-0000-000000000001";
 it.each(["qb_attach_competition_sponsor","qb_finalize_competition_leaderboard","qb_record_competition_result"])("anonymous and ordinary roles cannot mutate %s",async(name)=>{const args=name==="qb_attach_competition_sponsor"?{p_competition_id:invalid,p_sponsor_id:invalid}:name==="qb_record_competition_result"?{p_competition_id:invalid,p_entity_type:"STUDENT",p_entity_id:invalid,p_score:0}:{p_competition_id:invalid};for(const client of [anon,student,sponsor,seller])expect((await client.rpc(name,args)).error).not.toBeNull();});
 it("seller retains authorized own-entity update",async()=>{const own=await seller.from("marketplace_sellers").select("id,display_name").single();expect(own.error).toBeNull();const updated=await seller.from("marketplace_sellers").update({display_name:own.data!.display_name}).eq("id",own.data!.id).select("id");expect(updated.error).toBeNull();expect(updated.data).toEqual([{id:own.data!.id}]);});
 it("student cannot mutate the run's seller",async()=>{const own=await seller.from("marketplace_sellers").select("id,display_name").single();expect(own.error).toBeNull();const update=await student.from("marketplace_sellers").update({display_name:own.data!.display_name}).eq("id",own.data!.id).select("id");expect(update.error!==null||update.data?.length===0).toBe(true);});
 it("sponsor profile is readable only in its authorized context",async()=>{const own=await sponsor.from("sponsor_profiles").select("id,organization_name").single();expect(own.error).toBeNull();const other=await student.from("sponsor_profiles").select("id").eq("id",own.data!.id);expect(other.error!==null||other.data?.length===0).toBe(true);});
 it("ordinary student cannot insert a marketplace seller for another user",async()=>{const owner=await seller.auth.getUser();const r=await student.from("marketplace_sellers").insert({seller_type:"USER",seller_entity_id:owner.data.user!.id,display_name:"QBRUN denied seller"});expect(r.error).not.toBeNull();});
 it("production review excludes all fixture namespaces",async()=>{
  const scope={curriculum:world.curriculum.id,status:"review"};
  const production=await admin.rpc("qb_content_queue",{p_filters:{...scope,source:"production"},p_page:1,p_limit:25});
  expect(production.error).toBeNull();
  const ids=production.data.rows.map((q:any)=>q.id);
  expect(ids).toContain(productionQuestion);expect(ids).not.toContain(fixtureQuestion);
  expect(production.data.rows.every((q:any)=>!["DEV_ACCEPTANCE_FIXTURE","DEV_FACTORY_PILOT"].includes(q.source_type))).toBe(true);
  // Control: without the production filter the fixture-namespace question is visible, so the exclusion above is meaningful.
  const everything=await admin.rpc("qb_content_queue",{p_filters:scope,p_page:1,p_limit:25});
  expect(everything.error).toBeNull();expect(everything.data.rows.map((q:any)=>q.id)).toContain(fixtureQuestion);
 });
 it.each([0,-1,100001])("learner pagination rejects page %s",async(p_page)=>{const r=await teacher.rpc("qb_indicator_learners_page",{p_class_id:world.classroom.id,p_node_id:world.node.id,p_page,p_limit:25});expect(r.error).not.toBeNull();});
 it("learner drill-down is stable, bounded and owner-authorized",async()=>{const args={p_class_id:world.classroom.id,p_node_id:world.node.id,p_page:1,p_limit:1};const a=await teacher.rpc("qb_indicator_learners_page",args),b=await teacher.rpc("qb_indicator_learners_page",args);expect(a.error).toBeNull();expect(a.data.rows.length).toBeLessThanOrEqual(1);expect(a.data).toEqual(b.data);expect((await student.rpc("qb_indicator_learners_page",args)).error).not.toBeNull();});
 it("teardown leaves zero rows from the run",async()=>{const left=await destroyFixtureWorld(world);expect(left.total).toBe(0);},120000);
});
