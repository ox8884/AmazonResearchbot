# 로컬 암호화 백업·격리 복원

현재 Docker 개발 DB(`127.0.0.1:5433`, `forge_ops`)의 데이터를 보존하고, 새 격리 DB에서 복원을 확인하는 명령이다. 기존 DB를 덮어쓰거나 워커·API를 복원 DB로 전환하지 않는다.

## 실행

저장소 루트에서 실행한다. Node24, 기존 pnpm 의존성, 실행 중인 `forgeops` Docker Postgres가 필요하다.

```powershell
$forgeBackupRoot = "$env:LOCALAPPDATA/ForgeKitchenOps"
pnpm backup:local -- --key-file "$forgeBackupRoot/keys/local-backup-v2.key" --output "$forgeBackupRoot/backups" --escrow-dir "$forgeBackupRoot/recovery-escrow"
pnpm restore:local -- --target isolated --key-file "$forgeBackupRoot/keys/local-backup-v2.key" --archive "$forgeBackupRoot/backups/<id>.fops" --escrow "$forgeBackupRoot/recovery-escrow/<id>.keys.fops"
pnpm verify:restore -- --target isolated
```

현재 로컬 백업 키는 `%LOCALAPPDATA%/ForgeKitchenOps/keys/local-backup-v2.key`다. 전용 폴더는 현재 사용자·SYSTEM·관리자만 접근하도록 설정했다. 기존 `data/recovery-keys/local-backup-v1.key`는 이전 백업 복원용으로 보존했으며 새 서명 키 백업에는 사용하지 않는다. 이 파일 내용을 로그·채팅·Git에 넣지 않는다. 키를 잃으면 암호화된 파일을 복원할 수 없으므로 운영자가 보호된 별도 보관처로 인계해야 한다. 명령은 기존 키를 바꾸거나 생성하지 않으며 키 파일이 없으면 실패한다.

세 가지를 분리해 보관한다.

- `%LOCALAPPDATA%/ForgeKitchenOps/backups/<id>.fops`: AES-256-GCM으로 암호화한 DB custom dump와 완료 manifest.
- `%LOCALAPPDATA%/ForgeKitchenOps/recovery-escrow/<id>.keys.fops`: 해당 백업 ID에 묶인 인증·데이터 복호화 키와 구성된 브라우저 서명 개인키 자료. 별도 AES-256-GCM 암호문이다.
- `%LOCALAPPDATA%/ForgeKitchenOps/keys/local-backup-v2.key`: 위 두 파일을 여는 독립 백업 키. 백업 폴더와 복구 자료 폴더 안에는 둘 수 없다.

현재 백업·키·복구 자료는 저장소 밖의 전용 보호 폴더에 있다. 이전 `data/` 사본도 Git 제외 상태로 보존하며 외부 업로드는 하지 않았다.

## 보존·검증 범위

- `pg_export_snapshot()`으로 고정한 읽기 전용 스냅샷에서 `pg_dump -Fc --snapshot`을 실행한다.
- CSV 원본과 메일 원문·첨부는 현재 DB 안의 암호문 컬럼에 저장되므로 dump에 함께 들어간다. 외부 blob 저장소가 생기면 그 파일을 포함하는 경로를 추가로 구현해야 한다.
- manifest는 업무용 public 테이블의 행 수와 내용 SHA-256을 담는다. dump 자체의 SHA-256도 확인한다.
- 백업 전과 복원 후에 저장된 CSV 원본의 복호화·원본 hash, 인증 복구 기록으로 제공된 복구 키를 검사한다. 데이터나 인증 키가 맞지 않으면 성공으로 보고하지 않는다.
- 복원은 아카이브 인증·dump 무결성을 확인한 뒤 무작위 새 `forge_ops_restore_*` DB만 만든다. 소유권·ACL은 원본에서 적용하지 않고 로컬 `forge` 역할로 복원한다.
- 원본 대비 public 테이블을 검증하고 `deployment_identity`를 복원 검증용으로 격리한다. 검증이 실패해도 격리를 수행한다. 실제 development 워커 시작 거부를 인수 테스트에서 확인했다.
- 일반 복원 DB는 운영자 확인을 위해 남겨 둔다. 인수 테스트는 이번 실행의 고유 합성 계정과 격리 상태를 확인한 복원 DB만 정리한다. 원본 DB나 기존 백업을 삭제하지 않는다.

## 현재 한계와 남은 운영 작업

이 명령은 로컬 개발용이다. custom dump 최대64MiB를 메모리에서 처리하며, 초과하면 백업 실패로 종료한다. 복원 전 전체 암호문을 인증하므로 검증되지 않은 SQL을 먼저 실행하지 않는다.

Oracle 역할·권한 분리와 자동 실행, 외부 R2 업로드, 암호화 키의 별도 장소 인계, 보관기간 정리와 RPO24h/RTO4h 인수는 아직 완료하지 않았다. 같은 PC에 있는 로컬 사본을 장애에 독립적인 외부 백업으로 부르지 않는다.

실행 증거와 현재 소스 해시는 `.omo/evidence/local-backup/verification.json`에 기록한다. 전체 SPEC 완료 증거는 아니다.

개발 DB5433 및 Mailpit1025/8025는 Docker에서127.0.0.1로만 publish한다. 데이터 볼륨 forgeops_forge_ops_pg는 유지한다.

## 로컬 일일 자동 실행

`pnpm dev`가 별도 백업 프로세스를 함께 시작한다. 시작 직후와60초마다 확인하며, DB의 UTC 날짜 기준으로 유효한 완료 기록이 있으면 다시 만들지 않는다. 기본 백업 키가 없으면 미설정으로 대기하고 성공 기록을 남기지 않는다.

- `pnpm backup:schedule -- --once`: 지금 한 번 확인한다. 검증된 오늘 백업이 있으면 재사용한다.
- `LOCAL_BACKUP_KEY_FILE`, `LOCAL_BACKUP_DIRECTORY`, `LOCAL_BACKUP_ESCROW_DIRECTORY`로 경로를 지정할 수 있다. 메인의 .env는 위 전용 보호 폴더를 명시적으로 지정한다. 환경값이 없을 때 코드의 이전 data/ 경로 기본값은 유지되므로 새 서명 키 운영에는 구성된 보호 경로를 사용한다. 키는 두 산출물 폴더 밖에 있어야 한다.
- 프로세스 간 DB 잠금으로 동시 실행을 막는다. 감사 기록은 파일 두 개의 인증·내용 검증 및 hash 생성 뒤에만 완료로 추가한다.
- 같은 날에도 파일이 사라지거나 hash가 달라졌거나 백업 키가 바뀌면 새 백업을 만들고 이전 기록·파일은 삭제하지 않는다.
- 파일 생성 뒤 완료 기록을 쓰기 전에 프로세스가 중단되면 다음 실행이 새 백업을 만들 수 있다. 그런 미완료 산출물은 자동 삭제하지 않는다. 완료 기록이 있는 정상 백업은 재시작 후 재사용한다.
- `pnpm verify:local -- --scenario daily-backup`: 미설정/실패/완료기록쓰기실패/동시 실행/새프로세스/손상/키교체/다음UTC날짜를 격리 DB에서 검증한다.

이는 개발 프로세스가 실행되는 동안의 로컬 자동 백업이다. Windows 시작 자동 실행, Oracle systemd timer, 외부 R2 보관, retention 삭제와 장애에 독립적인 RPO/RTO 인수는 별도이며 현재 완료로 표시하지 않는다.

## 브라우저 서명 키 복구

브라우저 작업의 서명 키는 데이터 암호화 키와 별개다. `BROWSER_SIGNING_KEY_FILE`이 구성되면 수동 백업과 일일 백업 모두 해당 Ed25519 개인키를 읽어 별도 암호화 escrow에 보존한다. 작업 실행이 비활성화돼 있어도 구성된 키는 백업한다. 개인키는 로그·DB dump·manifest에 넣지 않으며 manifest에는 공개키 fingerprint만 저장한다.

DB에 서명 공개키가 등록돼 있으면 같은 공개키에 대응하는 개인키가 없거나 다른 키가 제공된 백업은 실패한다. 암호화 escrow와 manifest의 서명 fingerprint가 다르면 복원 DB 생성 전에 거부한다. 실제 DB 복원 뒤에도 공개키와 복구 키 일치를 다시 확인하고 복원 DB는 계속 격리한다. 복원 CLI는 개인키를 출력하거나 기존 서비스 파일을 자동 교체하지 않는다.

서명 키가 없던 기존 백업의 복원은 유지한다. 같은 날이라도 새 서명 키가 추가되면 기존 일일 완료 기록을 재사용하지 않고 키가 포함된 백업을 새로 만든다. 서명 키 누락을 기존 완료 기록으로 숨기지 않는다.

`pnpm exec tsx scripts/verify-backup.mjs`는 실제 격리 pg_restore 후 복구 키의 sign/verify를 확인한다. `scripts/verify-backup-cli.mjs`는 실제 CLI·기존 manifest·틀린 서명 escrow의 생성 전 거부를, `scripts/verify-daily-backup.mjs`는 같은 날 재백업과 별도 scheduler 프로세스의 키 로딩을 검증한다. 검증은 합성 키·격리 DB만 사용하며 실제 운영 키 생성·서비스 활성화·외부 업로드의 증거는 아니다.

2026-09-08 실제 반영 후 백업 `8d6bd452-b4e7-4ee3-b135-20c0159ecdbe`를 새 격리 DB에 복원했고, 60개 테이블·공개 서명 identity·개인키 sign/verify를 함께 확인했다. 원본 DB는 덮어쓰지 않았고 복원 DB는 격리 상태로 남겨 두었다.
