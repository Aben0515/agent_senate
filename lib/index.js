import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export const name = 'agent-senate-dsh';
export const PACKAGE_NAME = 'agent-senate-dsh';

export function resolveSenateSkillRoot(profileBaseUrl) {
  if (!profileBaseUrl) {
    throw new Error('agent-senate-dsh: missing DSH profile baseUrl for package resolution');
  }
  let manifestPath;
  try {
    manifestPath = createRequire(profileBaseUrl).resolve(`${PACKAGE_NAME}/package.json`);
  } catch (error) {
    throw new Error(
      `agent-senate-dsh: cannot resolve ${PACKAGE_NAME}/package.json from the DSH profile`,
      { cause: error },
    );
  }
  return join(dirname(manifestPath), 'skills');
}
