from pathlib import Path
import argparse
import json
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from build_pages import PUBLIC_FILES, main as build


def run(*args, cwd=ROOT):
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--message', required=True)
    args = parser.parse_args()
    build()
    for name in PUBLIC_FILES:
        committed = subprocess.check_output(['git', 'show', 'HEAD:' + name], cwd=ROOT)
        assert committed == (ROOT / name).read_bytes(), f'Uncommitted page: {name}'
    remote = run('git', 'remote', 'get-url', 'origin')
    repo = json.loads(run('gh', 'repo', 'view', '--json', 'nameWithOwner'))['nameWithOwner']
    author = {k: run('git', 'config', 'user.' + k) for k in ('name', 'email')}
    with tempfile.TemporaryDirectory(prefix='open-med-tray-pages-') as temp:
        dest = Path(temp)
        run('git', 'init', '-b', 'gh-pages', cwd=dest)
        run('git', 'remote', 'add', 'origin', remote, cwd=dest)
        for k, value in author.items():
            run('git', 'config', 'user.' + k, value, cwd=dest)
        if run('git', 'ls-remote', '--heads', 'origin', 'gh-pages', cwd=dest):
            run('git', 'fetch', '--depth=1', 'origin', 'gh-pages', cwd=dest)
            run('git', 'checkout', '-B', 'gh-pages', 'FETCH_HEAD', cwd=dest)
            for child in dest.iterdir():
                if child.name == '.git':
                    continue
                if child.is_dir():
                    shutil.rmtree(child)
                else:
                    child.unlink()
        for source in (ROOT / '_site').rglob('*'):
            if source.is_file():
                target = dest / source.relative_to(ROOT / '_site')
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
        run('git', 'add', '--all', cwd=dest)
        if run('git', 'status', '--porcelain', cwd=dest):
            run('git', 'commit', '-m', args.message, cwd=dest)
            run('git', 'push', 'origin', 'gh-pages', cwd=dest)
        print(run('gh', 'api', '--method', 'PUT', f'repos/{repo}/pages',
                  '-f', 'build_type=legacy', '-f', 'source[branch]=gh-pages', '-f', 'source[path]=/'))


if __name__ == '__main__':
    main()
