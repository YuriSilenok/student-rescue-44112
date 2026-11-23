#!/usr/bin/env bash
# Root-owned forced SSH command. Runs as student-deploy, never as root.
set -euo pipefail
umask 022
command=${SSH_ORIGINAL_COMMAND:-}
if [[ ! "$command" =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
  echo 'Only deployment of a commit SHA is allowed' >&2; exit 1
fi
sha=${BASH_REMATCH[1]}
base=/opt/student-rescue
exec 9>"$base/deploy.lock"
flock -w 180 9
staging=$(mktemp -d "$base/releases/incoming.XXXXXXXX")
trap 'rm -rf -- "$staging"' EXIT
timeout 120 head -c 52428801 >"$staging/bundle.tar.gz"
if [ "$(stat -c %s "$staging/bundle.tar.gz")" -gt 52428800 ]; then echo 'Archive too large' >&2; exit 1; fi
python3 - "$staging" <<'PY'
import sys,tarfile,pathlib
base=pathlib.Path(sys.argv[1]); target=base/'app'; target.mkdir()
with tarfile.open(str(base/'bundle.tar.gz'),'r:gz') as archive:
    members=archive.getmembers()
    if sum(m.size for m in members)>200*1024*1024: raise ValueError('Archive too large')
    for item in members:
        path=pathlib.PurePosixPath(item.name)
        if path.is_absolute() or '..' in path.parts or not (item.isfile() or item.isdir()):
            raise ValueError('Invalid archive member')
        if not path.parts or path.parts[0] not in ['backend','frontend','REVISION']:
            raise ValueError('Unexpected archive path')
    archive.extractall(str(target),members=members)
PY
test -f "$staging/app/frontend/dist/index.html"
test -f "$staging/app/backend/main.py"
test "$(cat "$staging/app/REVISION")" = "$sha"
/opt/student-rescue/python/bin/python3 -m venv "$staging/app/.venv"
"$staging/app/.venv/bin/python" -m pip install --disable-pip-version-check -q -r "$staging/app/backend/requirements.txt"
release="$base/releases/$sha-$(date +%s)"
mv "$staging/app" "$release"
# venv launch uses python -m uvicorn, so moving its absolute entrypoint scripts is harmless.
previous=$(readlink -f "$base/current" || true)
ln -s "$release" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
sudo /usr/bin/systemctl restart student-rescue.service
sleep 3
if ! systemctl is-active --quiet student-rescue.service; then
  if [ -n "$previous" ]; then
    ln -s "$previous" "$base/current.rollback"
    mv -Tf "$base/current.rollback" "$base/current"
    sudo /usr/bin/systemctl restart student-rescue.service
  fi
  echo 'Service failed to start; previous release restored' >&2; exit 1
fi
echo "Deployed $sha"
