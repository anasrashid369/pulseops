# PulseOps

A serverless, AI-assisted incident alerting and on-call platform — a scaled-down but architecturally real version of what PagerDuty or Opsgenie solve commercially.

When something breaks in production, engineering teams need to be paged immediately, with automatic escalation if the on-call engineer doesn't respond. PulseOps implements that entire loop: ingest an alert, classify its severity with AI, push a notification to the on-call engineer's phone, and automatically escalate to the next person in rotation if it goes unacknowledged — with a full audit trail of everything that happened.

## Architecture
Webhook (curl/monitoring tool)
↓
API Gateway (POST /alerts)
↓
Lambda: ingest-alert
├─→ DynamoDB: write incident record
├─→ Gemini API: classify severity (critical / warning / info)
├─→ DynamoDB: read on-call schedule
├─→ Firebase Cloud Messaging: push notification to on-call engineer
└─→ EventBridge Scheduler: schedule a 1-time escalation check
↓ (fires after N minutes if unacknowledged)
Lambda: escalate-incident
├─→ DynamoDB: check if still "open"
├─→ DynamoDB: read next person in on-call rotation
├─→ Firebase Cloud Messaging: push to backup on-call
└─→ DynamoDB: update status + append to history
Flutter mobile app
├─→ Receives push notifications (FCM)
└─→ POST /alerts/{id}/ack → Lambda: resolve-incident → DynamoDB update
GET /alerts/{id} → Lambda: get-incident → full incident timeline

## Tech Stack

**Backend (AWS, fully serverless)**
- AWS Lambda (Node.js 20) — event-driven compute, 4 functions: ingest, resolve, escalate, get
- Amazon API Gateway — REST API layer
- Amazon DynamoDB — incidents table + on-call schedule table (on-demand billing)
- Amazon EventBridge Scheduler — one-time escalation timers
- AWS Systems Manager Parameter Store — encrypted secrets (Firebase + Gemini credentials)
- AWS CDK (TypeScript) — 100% infrastructure as code, no manual console configuration
- IAM — least-privilege roles scoped per Lambda function

**Mobile**
- Flutter — cross-platform on-call client
- Firebase Cloud Messaging (HTTP v1 API) — push notification delivery

**AI**
- Google Gemini API (gemini-3.5-flash) — real-time severity classification with reasoning, used to decide urgency before paging

## Why These Design Choices

- **Lambda over ECS/Fargate**: alert ingestion is short-lived, event-triggered, and bursty. Pay-per-invocation fits a workload that's idle most of the time far better than an always-on container.
- **DynamoDB over RDS**: access patterns (get incident by ID, get on-call schedule) are simple and key-based. On-demand billing absorbs alert-storm traffic spikes without connection-pool limits that would be a problem for RDS under concurrent Lambda invocations.
- **EventBridge Scheduler over a hand-rolled timer**: escalation is fundamentally a "wait, then check" pattern. A managed one-time scheduler is simpler and cheaper than a Step Functions state machine for this scope, while still being fully serverless and auditable.
- **Parameter Store over Secrets Manager**: Secrets Manager has no meaningful free tier ($0.40/secret/month). Parameter Store's SecureString tier does the same job — encrypted storage, IAM-scoped access — at zero cost, appropriate for this project's scale.
- **Gemini API for AI triage**: a free, no-credit-card API tier made it possible to add a genuine AI decision layer (not a hardcoded rule) without ongoing cost — severity classification runs on every single incoming alert.

## Setup / Running This Yourself

**Prerequisites**: AWS account, Node.js 18+, AWS CDK CLI, Flutter SDK, Firebase project, Google AI Studio account (for Gemini API key).

```bash
# 1. Clone and install
git clone https://github.com/anasrashid369/pulseops.git
cd pulseops/infra
npm install

# 2. Bootstrap CDK (one-time per AWS account/region)
cdk bootstrap

# 3. Store secrets in Parameter Store
aws ssm put-parameter --name "/pulseops/fcm-service-account" --type "SecureString" --value "file://path-to-your-firebase-key.json"
aws ssm put-parameter --name "/pulseops/gemini-api-key" --type "SecureString" --value "YOUR_GEMINI_KEY"

# 4. Deploy
cdk deploy

# 5. Seed an on-call schedule
aws dynamodb put-item --table-name PulseOpsOnCall --item '{...}'  # see docs

# 6. Run the mobile app
cd ../mobile
flutter pub get
flutter run
```

## Estimated Cost at Scale

All core services (Lambda, DynamoDB, API Gateway, EventBridge Scheduler, Cognito-equivalent auth via Firebase) sit within AWS's Always Free tier at low-to-moderate volume. Estimated monthly cost:

| Alerts/month | Lambda invocations | DynamoDB requests | Estimated cost |
|---|---|---|---|
| 1,000 | ~4,000 | ~8,000 | $0 (within free tier) |
| 10,000 | ~40,000 | ~80,000 | $0 (within free tier) |
| 100,000 | ~400,000 | ~800,000 | ~$2-5/month (Lambda compute + DynamoDB requests exceed free tier; Gemini API calls remain free under 1,500/day cap, would need paid tier above that) |

Gemini's free tier caps at 1,500 requests/day — a real production deployment beyond that volume would need to move to Gemini's paid tier (~$0.30/million input tokens) or a self-hosted classification model.

## Project Structure
pulseops/
├── backend/
│   └── src/handlers/
│       ├── ingest-alert/       # Webhook receiver, AI triage, notification, escalation scheduling
│       ├── resolve-incident/   # Acknowledge endpoint
│       ├── escalate-incident/  # Fires on timeout, pages next on-call
│       ├── get-incident/       # Timeline/history endpoint
│       └── triage-incident/    # Gemini severity classification module
├── infra/
│   └── lib/infra-stack.ts      # Full AWS infrastructure as CDK code
└── mobile/
└── lib/main.dart           # Flutter on-call client

## What I'd Add Next

- Step Functions state machine for escalation (currently EventBridge Scheduler — simpler, but Step Functions would give a visual, auditable state machine for multi-level escalation chains)
- Multi-team support and severity-based routing (critical = page immediately, warning = batch into digest)
- Dead-letter queue for failed notification deliveries with retry/backoff
- Chaos test: deliberately fail the notification path and verify recovery
