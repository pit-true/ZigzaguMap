"""Check a CFRU-JP folder that has the build-support patches applied (reads only; works in a scratch folder).

    python build-support/tests/check_cfru_tree.py --cfru <CFRU-JP folder>

1. scripts/string.py: a string written on several lines (each line but the last ending with \\n, \\p, \\l or \\m)
   becomes the same bytes as the one-line string; a line break after anything else still starts a new string;
   an error is reported on the physical line of the bad character.
2. scripts/map_project.py: maps/rom_erase.json fills its ranges with 0xFF and changes nothing else; a range
   outside the base ROM, or one that a patch list of the build writes (bytereplacement, hooks, repoints,
   routinepointers, functionrewrites, generatedrepoints), stops the build. A disabled #ifdef line is not an overlap.
3. scripts/map_project.py: maps/trainers.json writes its trainers into gTrainers (*(0x0800F5C0)) with the parties in
   new space and changes nothing else; an empty Trainers list leaves the ROM unchanged; an id above 742 moves the table
   and repoints the words before it that point into its first entry; a bad id, a duplicate or a long name stops the build.
Exit code 1 when a check fails.
"""
import argparse
import contextlib
import importlib.util
import io
import json
import os
import pathlib
import shutil
import sys
import tempfile
import types

BS = chr(92)  # a backslash, written this way so that no escape is involved


def load(path, name, insert_stub=False):
    if insert_stub and 'insert' not in sys.modules:
        stub = types.ModuleType('insert')  # string.py takes the #include / #ifdef helpers from insert.py
        stub.TryProcessFileInclusion = lambda line, defines: False
        stub.TryProcessConditionalCompilation = lambda line, defines, conditionals: False
        sys.modules['insert'] = stub
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def convert(module, text):
    """The .s that scripts/string.py writes for a .string with this text (cwd: the scratch folder)."""
    with open('x.string', 'w', encoding='utf-8', newline='') as f:
        f.write(text)
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        try:
            module.StringFileConverter('x.string')
        except SystemExit:
            return None, out.getvalue()
    return open('x.s', encoding='utf-8').read(), out.getvalue()


def check_strings(cfru, work, problems):
    module = load(cfru / 'scripts' / 'string.py', 'zzm_string', insert_stub=True)
    module.CharMap = str(cfru / 'charmap.tbl')
    if not hasattr(module, 'ContinuesOnNextLine'):
        problems.append('scripts/string.py has no ContinuesOnNextLine (the patch is not applied)')
        return
    # \m is FA in charmaps that have it (ND); Chronos' charmap has no \m, so the check uses \l there
    with open(cfru / 'charmap.tbl', encoding='utf-8', errors='replace') as f:
        m = 'm' if any(line.rstrip('\r\n').endswith('=' + BS + 'm') for line in f) else 'l'
    one = (f'#org @gText_A\nこんにちは！{BS}nきょうは いいてんきだね{BS}pまたね\n\n'
           f'#org @gText_B\nああ{BS}lいい{BS}{m}うう\n#org @gText_C\nえ{BS}n  \nお\n')
    many = (f'#org @gText_A\nこんにちは！{BS}n\nきょうは いいてんきだね{BS}p\nまたね\n\n'
            f'#org @gText_B\nああ{BS}l\nいい{BS}{m}\nうう\n#org @gText_C\nえ{BS}n  \nお\n')
    a, _ = convert(module, one)
    b, _ = convert(module, many)
    c, _ = convert(module, many.replace('\n', '\r\n'))
    if a is None or a != b or a != c:
        problems.append('a string written on several lines is not the same as the one-line string')
    elif a.count('0xFF\n') != 4:   # A, B, C and the separate string after "\n  " (a space after the escape)
        problems.append(f'expected 4 strings, found {a.count("0xFF")}')
    sep, _ = convert(module, f'#org @gText_A\nああ{BS}n\n\nいい\n')
    if sep is None or sep.count('0xFF\n') != 2:
        problems.append('a blank line after a line-break escape must end the string')
    _, message = convert(module, f'#org @gText_A\nあ{BS}n\nい{BS}p\nう〓☃\n')
    if 'on line 4' not in message:
        problems.append(f'the error is not reported on the physical line: {message.strip()!r}')
    print('string.py: checked')


def write_erase(ranges):
    os.makedirs('maps', exist_ok=True)
    with open('maps/rom_erase.json', 'w', encoding='utf-8', newline='\r\n') as f:
        json.dump({'Format': 1, 'Ranges': ranges}, f, indent=2)


def check_rom_erase(cfru, work, problems):
    module = load(cfru / 'scripts' / 'map_project.py', 'zzm_map_project')
    rom = bytes(range(256)) * (0x2000000 // 256)

    def run():
        handle = io.BytesIO(rom)
        with contextlib.redirect_stdout(io.StringIO()):
            module.apply_project(handle, 0x1000000, {})
        return handle.getvalue()

    if run() != rom:
        problems.append('map_project.py changed the ROM without maps/')
    write_erase([{'Address': '0x08000100', 'Length': 16, 'Type': 'script', 'Bank': 3, 'Map': 0,
                  'Event': 'person', 'Index': 0}, {'Address': '0x0816A2B4', 'Length': 37, 'Type': 'text'}])
    expect = bytearray(rom)
    expect[0x100:0x110] = b'\xFF' * 16
    expect[0x16A2B4:0x16A2B4 + 37] = b'\xFF' * 37
    if run() != bytes(expect):
        problems.append('maps/rom_erase.json: the ranges are not filled, or other bytes changed')

    def must_fail(ranges, text, files=None):
        write_erase(ranges)
        for path, body in (files or {}).items():
            pathlib.Path(path).write_text(body, encoding='utf-8')
        try:
            run()
            problems.append(f'no error for {ranges} {files or ""}')
        except ValueError as e:
            if text not in str(e):
                problems.append(f'unexpected error {e} (expected {text})')
        for path in files or {}:
            os.remove(path)

    must_fail([{'Address': '0x07FFFFF0', 'Length': 4}], 'outside the base ROM')
    must_fail([{'Address': '0x08FFFFFE', 'Length': 4}], 'outside the base ROM')
    must_fail([{'Address': 256, 'Length': 4}], 'Invalid range')
    must_fail([{'Address': '0x08000100', 'Length': 0}], 'Invalid range')
    must_fail([{'Address': '0x08000100', 'Length': 4}], 'bytereplacement:2', {'bytereplacement': '# c\n08000102 01 02\n'})
    must_fail([{'Address': '0x08000100', 'Length': 4}], 'hooks:1', {'hooks': 'Sym 080000FA 0\n'})
    must_fail([{'Address': '0x08000100', 'Length': 4}], 'repoints:1', {'repoints': 'Sym 080000FE 4\n'})
    must_fail([{'Address': '0x08000100', 'Length': 4}], 'routinepointers:1', {'routinepointers': 'Sym 08000103\n'})
    must_fail([{'Address': '0x08000100', 'Length': 4}], 'functionrewrites:1', {'functionrewrites': 'Sym 080000F0 2 0\n'})
    must_fail([{'Address': '0x08000100', 'Length': 4}], 'generatedrepoints:2', {'generatedrepoints': '##g\nSym 254\n'})
    write_erase([{'Address': '0x08000100', 'Length': 4}])
    pathlib.Path('bytereplacement').write_text('#ifdef NOT_DEFINED\n08000100 01\n#endif\n080000FF 01\n08000104 02\n')
    try:
        if run()[0x100:0x104] != b'\xFF' * 4:
            problems.append('a disabled #ifdef line or a neighbouring line was taken as an overlap')
    except ValueError as e:
        problems.append(f'a disabled #ifdef line or a neighbouring line was taken as an overlap: {e}')
    os.remove('bytereplacement')
    print('map_project.py: checked')


def write_trainers(trainers):
    os.makedirs('maps', exist_ok=True)
    with open('maps/trainers.json', 'w', encoding='utf-8', newline='\r\n') as f:
        json.dump({'Format': 1, 'Trainers': trainers}, f, indent=2)


def check_trainers(cfru, work, problems):
    module = load(cfru / 'scripts' / 'map_project.py', 'zzm_map_project_trainers')
    if not hasattr(module, '_apply_trainers'):
        problems.append('scripts/map_project.py has no _apply_trainers (the trainers patch is not applied)')
        return
    shutil.copyfile(cfru / 'charmap.tbl', 'charmap.tbl')
    table, size, count = 0x1FDFD8, 0x20, 743
    base = bytearray(b'\xFF' * 0x2000000)
    for i in range(count):
        base[table + i * size:table + (i + 1) * size] = bytes([(i * 7 + k) & 0x7F for k in range(size)])
    for at, delta in ((0xF5C0, 0), (0x10000, 0), (0x10004, 4), (0x10008, 0xA)):
        base[at:at + 4] = (0x08000000 + table + delta).to_bytes(4, 'little')
    base[0x30000:0x30004] = (0x08000000 + table + 0x40).to_bytes(4, 'little')   # into entry 2: not a table reference
    rom = bytes(base)

    def run():
        handle = io.BytesIO(rom)
        with contextlib.redirect_stdout(io.StringIO()):
            module.apply_project(handle, 0x1000000, {})
        return handle.getvalue()

    one = {'Id': 5, 'PartyFlags': 0, 'Class': 3, 'Music': 4, 'Female': True, 'Pic': 12, 'Name': 'あい',
           'Items': [13, 0, 0, 0], 'DoubleBattle': False, 'AiFlags': 1, 'Party': [{'Iv': 0, 'Level': 9, 'Species': 10}]}
    write_trainers([])
    if run() != rom:
        problems.append('maps/trainers.json with no trainers changed the ROM')
    write_trainers([one])
    out = run()
    entry = out[table + 5 * size:table + 6 * size]
    party = int.from_bytes(entry[0x1C:0x20], 'little') - 0x08000000
    expect = bytes([0, 3, 0x84, 12, 0x01, 0x02, 0xFF, 0xFF, 0xFF, 0xFF, 13, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0])
    if entry[:0x1C] != expect:
        problems.append(f'trainer 5 is written wrong: {entry.hex()}')
    if out[party:party + 8] != bytes([0, 0, 9, 0, 10, 0, 0, 0]):
        problems.append(f'the party of trainer 5 is wrong: {out[party:party + 8].hex()}')
    changed = [i for i in range(len(rom)) if rom[i] != out[i] and not (table + 5 * size <= i < table + 6 * size) and not (party <= i < party + 8)]
    if changed:
        problems.append(f'maps/trainers.json changed other bytes: {[hex(i) for i in changed[:5]]}')
    write_trainers([dict(one, Id=750, PartyFlags=3, Party=[{'Iv': 1, 'Level': 50, 'Species': 6, 'HeldItem': 2, 'Moves': [1, 2, 3, 4]}])])
    out = run()
    new = int.from_bytes(out[0xF5C0:0xF5C4], 'little') - 0x08000000
    if new == table or out[new:new + count * size] != rom[table:table + count * size]:
        problems.append('trainer 750: the table is not copied to new space')
    elif [int.from_bytes(out[a:a + 4], 'little') - 0x08000000 - new for a in (0x10000, 0x10004, 0x10008)] != [0, 4, 0xA]:
        problems.append('trainer 750: the code references are not repointed')
    elif out[0x30000:0x30004] != rom[0x30000:0x30004]:
        problems.append('trainer 750: a word pointing into entry 2 was repointed')
    elif out[new + 750 * size + 0x18] != 1 or out[new + 749 * size:new + 750 * size] != rom[table:table + size]:
        problems.append('trainer 750: the new entries are wrong')
    for trainers, text in (([dict(one, Id=800)], 'Invalid or duplicate'), ([one, one], 'Invalid or duplicate'),
                           ([dict(one, Name='あ' * 6)], 'longer than'), ([dict(one, Party=[])], 'Party')):
        write_trainers(trainers)
        try:
            run()
            problems.append(f'no error for {text}')
        except ValueError as e:
            if text not in str(e):
                problems.append(f'unexpected error {e} (expected {text})')
    os.remove('maps/trainers.json')
    print('map_project.py (trainers): checked')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--cfru', required=True, help='the CFRU-JP folder (scripts/string.py, scripts/map_project.py)')
    args = parser.parse_args()
    cfru = pathlib.Path(args.cfru).resolve()
    work = pathlib.Path(tempfile.mkdtemp(prefix='zzm-build-support-'))
    problems = []
    previous = os.getcwd()
    try:
        os.chdir(work)
        check_strings(cfru, work, problems)
        check_rom_erase(cfru, work, problems)
        check_trainers(cfru, work, problems)
    finally:
        os.chdir(previous)
        shutil.rmtree(work, ignore_errors=True)
    for p in problems:
        print('NG:', p)
    print('OK' if not problems else f'{len(problems)} problem(s)')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
