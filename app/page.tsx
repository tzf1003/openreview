import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { Readme } from "./components/readme";

const Page = async () => {
  const content = await readFile(join(process.cwd(), "README.md"), "utf8");

  return <Readme content={content} />;
};

export default Page;
