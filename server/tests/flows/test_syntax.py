from farm.flows.syntax import MaestroSyntaxChecker, SyntaxIssue, parse_issues


def test_parse_issues():
    output = "Invalid Command: notACommand at /syntax-checker:4:14\nMissing Command Options at /syntax-checker:3:3\n"
    assert parse_issues(output) == [SyntaxIssue("Invalid Command: notACommand", 4, 14),
                                    SyntaxIssue("Missing Command Options", 3, 3)]
    assert parse_issues("something else") == []


def test_checker_reports_fake_maestro_errors(fakebin):
    checker = MaestroSyntaxChecker()
    assert checker.check("appId: x\n---\n- launchApp\n") == []
    assert checker.check("appId: x\n---\n- notACommand: 1\n") == [SyntaxIssue("Invalid Command: notACommand", 3, 3)]
    assert fakebin.calls("maestro")[0][0] == "check-syntax"


def test_checker_without_maestro_skips(tmp_path):
    assert MaestroSyntaxChecker(maestro=str(tmp_path / "missing")).check("- notACommand") == []


def test_unparsed_failure_keeps_output(tmp_path):
    script = tmp_path / "maestro"
    script.write_text("#!/bin/sh\necho 'kaboom' >&2\nexit 3\n")
    script.chmod(0o755)
    assert MaestroSyntaxChecker(maestro=str(script)).check("x") == [SyntaxIssue("kaboom")]
