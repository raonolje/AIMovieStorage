import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The frozen contract test expects scratch/. The distributable fixture lives
// with the test sources, so clean exports can run that exact test unchanged.
export default function prepareComfyCpuFixture() {
  const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
  const source=resolve(root,"client/src/lib/__fixtures__/workflow-node-schemas.json");
  const target=resolve(root,"scratch/workflow-node-schemas.json");
  const bytes=readFileSync(source);
  mkdirSync(dirname(target),{recursive:true});
  try { writeFileSync(target,bytes,{flag:"wx"}); }
  catch(error) {
    if(error.code!=="EEXIST")throw error;
    if(!readFileSync(target).equals(bytes))throw new Error("workflow CPU fixture differs; preserve the existing file and inspect it before retrying");
  }
}
