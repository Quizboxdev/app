import { operatorClient } from "./operator";
async function main() {
  const client=await operatorClient(),result=await client.rpc("qb_recent_operations",{p_page:1,p_failures_only:!process.argv.includes("--all")});
  if(result.error)throw new Error("OPERATIONS_ACCESS_DENIED");
  console.log(JSON.stringify(result.data,null,2));
}
main().catch(()=>{console.error("OPERATIONS_READ_FAILED");process.exitCode=1;});
