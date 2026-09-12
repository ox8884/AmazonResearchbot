# Oracle 운영 준비

이 폴더는 배포 검토용이다. 서버 설치·권한 변경·서비스 시작·재부팅을 실행하지 않았다. Windows의 정책/프로세스 검증은 실제 Oracle, systemd, peer 인증, 재부팅 인수를 대신하지 않는다.

## 로컬 실행기

`pnpm dev`와 `pnpm migrate`는 development 모드와 로컬 compose의 `forge_ops` DB(5433)만 허용한다. 마이그레이션 전에 단일 development 식별자를 확인하며, 새 빈 DB 또는 비어 있는 초기 migration journal만 최초 설치로 허용한다. production/복원 격리/알 수 없는 기존 DB에는 마이그레이션하지 않는다.

## 기동 조건

- 승인된 Oracle에서 Linux의 전용 OS 계정으로 해당 systemd system unit(`/system.slice/forge-ops-*.service`) 안에서 실행해야 한다. 같은 이름의 user unit도 거부한다.
- `/etc/forge-ops`와 `worker-authority.json`은 root 소유이고 다른 사용자가 쓸 수 없어야 한다. 파일은 서비스 계정이 읽을 수 있는 0644 또는 적절한 그룹의 0640으로 둔다. **키를 이 파일에 넣지 않는다.**
- `worker-authority.example.json`의 빈 값은 의도적으로 거부된다. 승인된 서버의 `/etc/machine-id`와 `oracle:<실제 instance OCID>`를 read-only preflight로 확인한 뒤 설정한다. 이 파일은 root가 승인한 호스트 바인딩이며 OCI의 암호학적 원격 증명이 아니다.
- DB `deployment_identity`는 정확히 한 행이어야 하고, `environment=production` 및 같은 worker identity여야 한다. 복원 격리 DB나 development/production 혼합 표시는 거부된다.
- DB는 `/var/run/postgresql` Unix socket, DB 이름 `forge_ops`, 해당 역할의 peer 인증만 허용한다. TCP, 비밀번호 URI, role 변경, 추가 DB options로 우회할 수 없다.
- runtime 역할은 superuser/createdb/createrole/replication/bypassrls, 다른 역할 membership, schema CREATE, DB CREATE, 업무 테이블 소유 권한이 없어야 한다.
- API는 큐 payload를 읽거나 어떤 job partition도 UPDATE할 수 없어야 한다. 스케줄러는 조회/추가만, 워커만 모든 실제 job table의 조회/claim 권한을 가진다. 부모 `pgboss.job`만 검사하지 않고 `pgboss.queue.table_name`에 등록된 물리 테이블도 검사한다.
- 워커의 기존 DB advisory lock이 중복 소비자 기동을 막는다. SIGTERM은 새 queue claim을 먼저 멈추고 이미 시작한 작업을 기다린다.

## 비밀정보 전달

`LoadCredential=`로 root 전용 파일의 내용을 서비스에 전달한다. Node 코드는 `CREDENTIALS_DIRECTORY`가 해당 system unit의 `/run/credentials/forge-ops-<역할>.service`인지 확인한 뒤 일반 파일을 읽고 소유자/권한/크기를 검사한다. 프로덕션에서 평문 `ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, JS/Composio 키 환경변수 fallback은 거부된다. 로드한 값은 `process.env`에 다시 쓰지 않는다.

- worker: `encryption-key`
- API: `encryption-key`, `auth-secret`
- scheduler: 데이터 암호화 master key를 받지 않음
- 승인 후 JS를 켜는 경우 worker/scheduler unit의 별도 drop-in에 `js-api-key-name`, `js-api-key` credential이 필요함
- 승인 후 API의 Composio를 켜는 경우 `COMPOSIO_ENABLED=true`와 `composio-api-key` credential이 필요함

기본 unit은 외부 transport를 disabled로 둔다. `runtime.env`에는 승인된 HTTPS `WEB_ORIGIN` 등 비밀이 아닌 값만 둔다. 개발용 `.env`를 복사하지 않는다. unit의 `--production` 인자는 환경파일로 모드를 development로 낮추는 실수를 차단한다.

공식 근거: [systemd credentials](https://systemd.io/CREDENTIALS/), [PostgreSQL system_user](https://www.postgresql.org/docs/17/functions-info.html), [PostgreSQL peer 인증](https://www.postgresql.org/docs/17/auth-peer.html).

## 설치 전 필요한 검토

1. 실제 OS/아키텍처, `/usr/bin/node` 24, systemd/credential 지원, 기존 포트·서비스·여유 공간을 읽기 전용으로 확인한다. 기존 앱을 중단하지 않는다.
2. `forge-ops-api`, `forge-ops-worker`, `forge-ops-scheduler`, 별도 migration 계정/DB 역할을 준비한다. runtime 역할이 migration이나 queue 생성 DDL을 하지 않게 한다.
3. 승인된 Oracle용 배포 실행기에서 별도 migration 역할로 additive SQL과 pg-boss 설치, `candidate.advance` queue 생성을 마친다. production startup은 queue를 생성하지 않는다. 로컬 `scripts/migrate.ts`를 프로덕션용으로 우회하지 않는다.
4. 전용 DB의 authority 행을 승인된 Oracle identity에 연결한다. 기존 production identity가 다르면 자동으로 덮어쓰지 않는다.
5. `postgres/*.fragment.conf`는 전용 DB 규칙만 기존 broad 허용 규칙보다 앞에 검토·병합한다. 공유 서버의 전체 pg_hba/pg_ident/방화벽을 교체하지 않는다.
6. API의 auth/업무 DML, worker의 실제 업무 DML, scheduler의 요약/큐 producer 권한을 개별 부여한다. runtime에는 `schema_migrations`, `deployment_identity` SELECT만 준다. queue INSERT RETURNING에 필요한 id/start_after 읽기 권한과 payload/claim 권한을 구분한다. 실제 role별 실행 검증 전에는 권한 설정을 완료했다고 보지 않는다.
7. 불변 release를 `/opt/forge-ops/releases/<commit>`에 두고 checksum을 확인한다. 승인 후에만 `/opt/forge-ops/current`를 전환하고 unit을 설치한다.
8. 실제 호스트에서 `systemd-analyze verify`와 startup/kill/restart를 확인한다. 공유 호스트 reboot는 별도 승인과 전후 부팅 ID·작업 중복 검사로 수행한다.

## 아직 남은 운영 인수

실제 role별 GRANT 적용/검증, 관리자 최초 bootstrap, Cloudflare edge/Tunnel, production backup/R2 업로드 및 복원, release installer/rollback, 실제 Oracle 재부팅은 이 단계에서 완료하지 않았다. 이 폴더의 unit은 그 작업들의 성공 증거가 아니다.
