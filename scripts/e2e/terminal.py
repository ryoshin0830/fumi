"""Run the browser-copied command in a real terminal; never use host keys."""

import json
import os
import pathlib
import re
import subprocess
import sys

import pexpect


config = json.loads(pathlib.Path(sys.argv[1]).read_text())
env = dict(os.environ, GNUPGHOME=config["keyring"], TERM="xterm", LANG="C.UTF-8", LC_ALL="C.UTF-8")
env.pop("GPG_TTY", None)
shell = config.get("shell", "/bin/zsh")
child = pexpect.spawn(shell, ["-f"] if shell.endswith("zsh") else [],
                      cwd=config["cwd"], env=env, encoding="utf-8", timeout=25,
                      echo=True, dimensions=(40, 120), codec_errors='replace')
transcript = []
stage = 'shell-start'
interrupted = False
temporary_before = set(pathlib.Path('/tmp').glob('fumi-????????'))
try:
    child.sendline("PS1='FUMI_PROMPT> '; PS2=''; HISTSIZE=1000; SAVEHIST=1000; HISTFILE=./test-history" + ("; unsetopt zle" if shell.endswith("zsh") else "") + "; printf '\\nFUMI_READY\\n'")
    child.expect(r"\r?\nFUMI_READY\r?\n")
    child.expect_exact("FUMI_PROMPT> ")
    child.setecho(True)
    stage = 'browser-clipboard'
    copied = subprocess.check_output(["xclip", "-selection", "clipboard", "-out"]).decode()
    assert copied == config["command"], "Browser Copy did not reach the real X clipboard"
    child.sendline(copied)
    child.expect_exact(copied.replace('\n', '\r\n') + '\r\n')
    for step in config["inputs"]:
        stage = step['kind'] + '-' + step['delivery']
        marker = "秘密鍵をコピーして Enter" if step["kind"] == "key" else "暗号文をコピーして Enter"
        child.expect_exact(marker)
        assert child.getecho() is False, 'Prompt appeared before private input echo was disabled'
        transcript.append(child.before)
        if step['delivery'] == 'interrupt':
            child.sendcontrol('c')
            interrupted = True
            break
        text = pathlib.Path(step["file"]).read_text()
        if step["delivery"] == "clipboard":
            subprocess.run(["xclip", "-selection", "clipboard"], input=text.encode(), check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            child.sendline("")
        else:
            child.send(text.rstrip("\n") + "\n")
    if config.get("password") and not interrupted:
        stage = 'passphrase'
        child.expect(re.compile(r"Passphrase:|Enter passphrase|Password:", re.I))
        child.send(config["password"])
        child.send("\t\r" if config['id'].startswith('pgp-') else "\r")
    stage = 'native-completion'
    child.expect_exact("FUMI_PROMPT> ")
    assert child.getecho() is True, 'Terminal echo was not restored'
    transcript.append(child.before)
    child.sendline("printf 'FUMI_STATUS:%s\\n' $?")
    child.expect(r"FUMI_STATUS:(\d+)")
    status = int(child.match.group(1))
    child.expect_exact("FUMI_PROMPT> ")
    child.sendline("fc -ln -100; printf '\\nFUMI_HISTORY_DONE\\n'")
    child.expect(r"\r?\nFUMI_HISTORY_DONE\r?\n")
    history = child.before
    child.expect_exact("FUMI_PROMPT> ")
    assert '--decrypt' in history, 'The test shell must actually record command history'
    assert not config.get('password') or config['password'] not in history, 'Passphrase entered history'
    terminal_output = '\n'.join(transcript)
    for step in config["inputs"]:
        payload = pathlib.Path(step["file"]).read_text().splitlines()
        assert not any(len(line) > 30 and not line.startswith('-----') and line in history for line in payload), "Payload entered shell history"
        assert not any(len(line) > 30 and not line.startswith('-----') and line in terminal_output for line in payload), "Payload echoed in terminal output"
    assert not any("command not found" in part or "no such file" in part for part in transcript), "Pasted input escaped into the shell"
    assert not set(pathlib.Path('/tmp').glob('fumi-????????')) - temporary_before, 'Temporary key material was not removed'
    if interrupted:
        assert status != 0, 'Interrupted command must fail'
        assert not pathlib.Path(config['cwd'], 'restored').exists()
    else:
        assert status == 0, f"Native command exited {status}"
        assert pathlib.Path(config["cwd"], "restored").read_bytes() == pathlib.Path(config["original"]).read_bytes(), "Restored bytes differ"
    print(json.dumps({"ok": True, "case": config["id"], "shell": shell, "exit": status,
                      "realClipboard": True, "historyContainsPayload": False,
                      "payloadEchoed": False, "echoRestored": True, "interrupted": interrupted}))
except Exception as error:
    # Diagnostic snippets exclude the generated key and ciphertext bodies.
    text = child.before if isinstance(child.before, str) else ""
    native_errors = [re.sub(r'[A-Za-z0-9+/=]{32,}', '[payload]', line) for line in text.splitlines()
                     if re.search(r"gpg:|age:|command not found|no such file", line)]
    print(json.dumps({"ok": False, "case": config["id"], "error": str(error).splitlines()[0],
                      "stage": stage, "nativeErrors": native_errors[:6],
                      "diagnostic": re.sub(r'[A-Za-z0-9+/=]{32,}', '[payload]', text[-700:])}, ensure_ascii=False))
    sys.exit(1)
finally:
    child.close(force=True)
