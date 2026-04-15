import { createPublicClassesApiResponder } from "../src/server/publicClassesApi.js";

const respond = createPublicClassesApiResponder();

export default async function handler(_request, response) {
  const result = await respond();

  response.status(result.status);
  Object.entries(result.headers).forEach(([key, value]) => {
    response.setHeader(key, value);
  });
  response.send(result.body);
}
