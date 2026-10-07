from pathlib import Path
import sys
repo=Path(sys.argv[1]); p=repo/'src/features/tasks/registration-track-fixtures.ts'
backup=repo/'output/playwright/registration-selection/fixture-source.original'
backup.parent.mkdir(parents=True,exist_ok=True)
if len(sys.argv)>2 and sys.argv[2]=='restore':
 p.write_bytes(backup.read_bytes()); sys.exit()
s=p.read_text()
if "import { withRegistrationClassSelectionFixture }" in s:
 raise SystemExit("fixture already staged; restore before staging again")
backup.write_text(s)
s='import { withRegistrationClassSelectionFixture } from "../../../tests/helpers/registration-class-selection-fixture.mjs"\n'+s
start=s.index('export function createRegistrationSubjectTrackFixtureState()')
a=s[:start];b=s[start:];b=b.replace('  return {\n    workspaceData,','  return withRegistrationClassSelectionFixture({\n    workspaceData,',1);b=b.replace('    sequence: 0,\n  }\n}', '    sequence: 0,\n  })\n}',1)
p.write_text(a+b)
