"""Run the browser-copied paste command in a real terminal with disposable data."""
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
child = pexpect.spawn("/bin/zsh", ["-f"], cwd=config["cwd"], env=env,
                      encoding="utf-8", timeout=25, echo=True,
                      dimensions=(40, 120), codec_errors="replace")
transcript = []
stage = "shell-start"
interrupted = False
temporary_before = set(pathlib.Path("/tmp").glob("fumi-????????"))
input_before = {step["file"]: pathlib.Path(step["file"]).read_bytes()
                for step in config["inputs"] if "file" in step and pathlib.Path(step["file"]).is_file()}
try:
    child.sendline("PS1='FUMI_PROMPT> '; PS2=''; HISTSIZE=1000; SAVEHIST=1000; HISTFILE=./test-history; unsetopt zle; printf '\\nFUMI_READY\\n'")
    child.expect(r"\r?\nFUMI_READY\r?\n")
    child.expect_exact("FUMI_PROMPT> ")
    child.setecho(True)
    stage = "browser-clipboard"
    copied = subprocess.check_output(["xclip", "-selection", "clipboard", "-out"]).decode()
    assert copied == config["command"], "Browser Copy did not reach the real X clipboard"
    child.sendline(copied)
    child.expect_exact(copied.replace("\n", "\r\n") + "\r\n")
    for step in config["inputs"]:
        stage = step["kind"] + "-" + step.get("delivery", "paste")
        marker = "秘密鍵を貼り付け" if step["kind"] == "key" else "暗号文を貼り付け"
        child.expect_exact(marker)
        assert child.getecho() is False, "Prompt appeared before echo was disabled"
        transcript.append(child.before)
        if step.get("delivery") == "interrupt":
            child.sendcontrol("c")
            interrupted = True
            break
        if step.get("delivery") == "blank":
            child.sendline("")
            continue
        if step.get("delivery") in ("path", "quoted-path"):
            text = step["file"]
            if step["delivery"] == "quoted-path":
                text = '"' + text + '"'
        else:
            text = pathlib.Path(step["file"]).read_text()
        subprocess.run(["xclip", "-selection", "clipboard"], input=text.encode(),
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        pasted = subprocess.check_output(["xclip", "-selection", "clipboard", "-out"]).decode()
        assert pasted == text
        child.send(pasted.rstrip("\n") + "\n")
    if config.get("password") and not interrupted:
        stage = "passphrase"
        child.expect(re.compile(r"Passphrase:|Enter passphrase|Password:", re.I))
        transcript.append(child.before)
        child.send(config["password"])
        child.send("\t\r" if config["id"].startswith("pgp-") else "\r")
    stage = "native-completion"
    child.expect_exact("FUMI_PROMPT> ")
    assert child.getecho() is True, "Terminal echo was not restored"
    transcript.append(child.before)
    child.sendline("printf 'FUMI_STATUS:%s\\n' $?")
    child.expect(r"FUMI_STATUS:(\d+)")
    status = int(child.match.group(1))
    child.expect_exact("FUMI_PROMPT> ")
    child.sendline("fc -ln -100; printf '\\nFUMI_HISTORY_DONE\\n'")
    child.expect(r"\r?\nFUMI_HISTORY_DONE\r?\n")
    history = child.before
    child.expect_exact("FUMI_PROMPT> ")
    assert "--decrypt" in history, "The shell must actually record history"
    terminal_output = "\n".join(transcript)
    if config.get("password"):
        assert config["password"] not in history
        assert config["password"] not in terminal_output
    for source, contents in input_before.items():
        assert pathlib.Path(source).read_bytes() == contents, "Input file was changed"
        for line in contents.decode("utf-8", errors="replace").splitlines():
            if len(line) > 30 and not line.startswith("-----"):
                assert line not in history, "Payload entered shell history"
                assert line not in terminal_output, "Input was echoed"
    assert "command not found" not in terminal_output, "Pasted input escaped into the shell"
    assert not pathlib.Path(config["cwd"], "injected").exists(), "File path was evaluated as shell code"
    assert not set(pathlib.Path("/tmp").glob("fumi-????????")) - temporary_before, "Temporary key material remains"
    cwd = pathlib.Path(config["cwd"])
    assert (cwd / "restored").read_text() == "existing file must stay", "Existing file was overwritten"
    expected = pathlib.Path(config["original"]).read_bytes()
    saved = list(cwd.glob("restored-*"))
    if interrupted or config.get("expectFailure"):
        assert status != 0, "Failed or interrupted decryption must fail"
        assert "復号した内容:" not in terminal_output, "Unverified plaintext was displayed"
        assert not saved
    elif config.get("saveFile"):
        assert status == 0, "Native decryption failed with status " + str(status)
        assert len(saved) == 1
        assert saved[0].read_bytes() == expected
        assert saved[0].name in terminal_output, "Saved file location was not displayed"
        assert saved[0].stat().st_mode & 0o777 == 0o600, "Saved output is not private"
        assert "復号した内容:" not in terminal_output, "File contents reached the terminal"
    else:
        assert status == 0, "Native decryption failed"
        assert "復号した内容:" in terminal_output, "Successful result was not displayed"
        assert expected.decode().replace("\n", "\r\n") in terminal_output, "Restored content is missing from the terminal"
        assert not saved, "Text was saved instead of displayed"
    print(json.dumps({"ok": True, "case": config["id"], "exit": status,
                      "realClipboard": True, "historyContainsPayload": False,
                      "echoRestored": True, "visibleText": not interrupted and not config.get("saveFile") and not config.get("expectFailure"),
                      "binarySaved": bool(saved), "interrupted": interrupted,
                      "expectedFailure": bool(config.get("expectFailure"))}))
except Exception as error:
    text = child.before if isinstance(child.before, str) else ""
    print(json.dumps({"ok": False, "case": config["id"], "stage": stage,
                      "error": (str(error) or type(error).__name__).splitlines()[0],
                      "diagnostic": re.sub(r"[A-Za-z0-9+/=]{32,}", "[payload]", text[-700:])},
                     ensure_ascii=False))
    sys.exit(1)
finally:
    child.close(force=True)
