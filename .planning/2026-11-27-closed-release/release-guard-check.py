from pathlib import Path
import os, subprocess, tarfile, tempfile

root = Path.cwd()
release_script = (root / 'scripts/deploy/production-release.sh').read_text()
cases = [
 ('off', 'SITE_PASSWORD_ENABLED=false', None, False),
 ('missing', '# no setting', None, False),
 ('prefix', 'SITE_PASSWORD_ENABLED=trueish', None, False),
 ('last wins', 'SITE_PASSWORD_ENABLED=true\nSITE_PASSWORD_ENABLED=false', None, False),
 ('shell override', 'SITE_PASSWORD_ENABLED=true', 'false', False),
 ('closed', 'SITE_PASSWORD_ENABLED=true', None, True),
 ('quoted', "SITE_PASSWORD_ENABLED='true' # closed", None, True),
]
errors = 0
for name, setting, override, should_reach in cases:
 with tempfile.TemporaryDirectory() as tmp:
  d = Path(tmp)
  (d/'production.env').write_text(setting+'\n')
  (d/'scripts').mkdir()
  (d/'scripts/backup.sh').write_text('touch "$GUARD_TEST_MARKER"\nexit 77\n')
  with tarfile.open(d/'an30-abc.tar.gz','w:gz') as a:
   a.add(root/'compose.yaml',arcname='compose.yaml')
   a.add(d/'scripts',arcname='scripts')
  # Validate with the real Compose parser offline. Reject every other Docker action.
  docker = subprocess.check_output(['which','docker'],text=True).strip()
  (d/'docker').write_text('#!/bin/sh\ncase " $* " in *" config "*) exec "'+docker+'" "$@";; *) exit 1;; esac\n')
  (d/'docker').chmod(0o755)
  script=release_script.replace('/tmp/an30-$sha',tmp+'/an30-$sha').replace('/opt/an30/releases',tmp+'/releases').replace('/etc/an30/production.env',tmp+'/production.env')
  (d/'release.sh').write_text(script)
  env={'PATH':tmp+':'+os.environ['PATH'],'HOME':os.environ['HOME'],'GUARD_TEST_MARKER':str(d/'backup-reached')}
  if override is not None: env['SITE_PASSWORD_ENABLED']=override
  p=subprocess.run(['bash',d/'release.sh','abc'],env=env,capture_output=True)
  reached=(d/'backup-reached').exists()
  ok=reached==should_reach and ((p.returncode==77) if should_reach else (p.returncode!=0))
  print(name,'PASS' if ok else 'FAIL', 'backup reached:',reached)
  errors+=not ok
raise SystemExit(bool(errors))
