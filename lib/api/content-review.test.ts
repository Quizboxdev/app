import { beforeEach,it,expect,vi } from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn()}));
vi.mock('@/lib/supabase/client',()=>({getSupabaseBrowserClient:()=>mocks}));
import {getContentDetail,listContentQueue} from './content-factory';
beforeEach(()=>{mocks.rpc.mockReset();mocks.from.mockReset();});
it('uses only protected editorial RPCs to inspect validation flags across pages',async()=>{
 const rows=Array.from({length:26},(_,i)=>({id:String(i),status:'inactive'}));
 mocks.rpc.mockImplementation(async(name,args)=>({error:null,data:name==='qb_content_queue'?{rows:rows.slice((args.p_page-1)*25,args.p_page*25),total:26}:{validation_errors:args.p_id==='25'?['INVALID_INDICATOR']:[]}}));
 const queue=await listContentQueue({source:'production',status:'review',validation:'flagged'},1);
 expect(queue.total).toBe(1);expect(queue.rows[0].id).toBe('25');expect(mocks.from).not.toHaveBeenCalled();
 expect(mocks.rpc.mock.calls.every(([name])=>['qb_content_queue','qb_content_detail'].includes(name))).toBe(true);
});
it('shows existing curriculum ancestry without rewriting source/canonical grades',async()=>{
 mocks.rpc.mockResolvedValue({error:null,data:{question:{source_grade_code:'B10',canonical_grade_code:'SHS1'},mapping:{id:'indicator',parent_id:'standard',code:'B10.1.3.1.1',node_type:'learning_indicator'}}});
 const query={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue({error:null,data:{id:'standard',parent_id:null,node_type:'content_standard',code:'B10.1.3.1',title:'Actual imported title'}})};
 mocks.from.mockReturnValue(query);
 const detail=await getContentDetail('question');expect(detail.ancestry.map((n:any)=>n.node_type)).toEqual(['learning_indicator','content_standard']);expect(detail.question).toEqual({source_grade_code:'B10',canonical_grade_code:'SHS1'});expect(mocks.from).toHaveBeenCalledWith('curriculum_nodes');
});
it('propagates authorization failures instead of falling back to direct question reads',async()=>{
 mocks.rpc.mockResolvedValue({error:{message:'QB_PERMISSION_DENIED'},data:null});
 await expect(getContentDetail('private')).rejects.toEqual({message:'QB_PERMISSION_DENIED'});expect(mocks.from).not.toHaveBeenCalled();
});
