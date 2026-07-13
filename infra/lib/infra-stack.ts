import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const DEVICE_TOKEN = 'eGQuj4deQtWirYJokaZFA8:APA91bFcNYA-NkQ-h45PV7kEZpnxWNwma82YkLSwLisEgONDD95jgNXXQL0DXoOGP7u-FldMKmVOAKU4PN9zHcWBKfaOwz8nNKIPwRSR2ZiOpkdcQ9FVq74';

    // DynamoDB table - incidents
    const table = new dynamodb.Table(this, 'IncidentsTable', {
      tableName: 'PulseOpsIncidents',
      partitionKey: { name: 'incidentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // DynamoDB table - on-call schedule
    const onCallTable = new dynamodb.Table(this, 'OnCallScheduleTable', {
      tableName: 'PulseOpsOnCall',
      partitionKey: { name: 'scheduleId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Escalate Lambda (defined first, since ingestFn needs to reference it)
    const escalateFn = new lambda.Function(this, 'EscalateIncidentFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../backend/src/handlers/escalate-incident'),
      environment: {
        TABLE_NAME: table.tableName,
        ONCALL_TABLE_NAME: onCallTable.tableName,
        BACKUP_DEVICE_TOKEN: DEVICE_TOKEN,
      },
      timeout: cdk.Duration.seconds(15),
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });
    table.grantReadWriteData(escalateFn);
    onCallTable.grantReadData(escalateFn);
    escalateFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/pulseops/fcm-service-account`],
    }));

    // IAM role that EventBridge Scheduler assumes to invoke escalateFn
    const schedulerRole = new iam.Role(this, 'SchedulerInvokeRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });
    escalateFn.grantInvoke(schedulerRole);

    // Ingest Lambda
    const ingestFn = new lambda.Function(this, 'IngestAlertFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../backend/src/handlers/ingest-alert'),
      environment: {
        TABLE_NAME: table.tableName,
        ONCALL_TABLE_NAME: onCallTable.tableName,
        TEST_DEVICE_TOKEN: DEVICE_TOKEN,
        ESCALATE_FUNCTION_ARN: escalateFn.functionArn,
        SCHEDULER_ROLE_ARN: schedulerRole.roleArn,
      },
      timeout: cdk.Duration.seconds(20),
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });
    table.grantWriteData(ingestFn);
    onCallTable.grantReadData(ingestFn);
    ingestFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/pulseops/fcm-service-account`],
    }));
    ingestFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/pulseops/gemini-api-key`],
    }));
    ingestFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['scheduler:CreateSchedule'],
      resources: [`arn:aws:scheduler:${this.region}:${this.account}:schedule/default/escalate-*`],
    }));
    ingestFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      resources: [schedulerRole.roleArn],
    }));

    // Resolve Lambda
    const resolveFn = new lambda.Function(this, 'ResolveIncidentFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../backend/src/handlers/resolve-incident'),
      environment: { TABLE_NAME: table.tableName },
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });
    table.grantWriteData(resolveFn);

    // API Gateway
    const api = new apigateway.RestApi(this, 'PulseOpsApi', {
      restApiName: 'PulseOps Service',
    });

    const alerts = api.root.addResource('alerts');
    alerts.addMethod('POST', new apigateway.LambdaIntegration(ingestFn));
    // List Incidents Lambda
    const listIncidentsFn = new lambda.Function(this, 'ListIncidentsFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../backend/src/handlers/list-incidents'),
      environment: { TABLE_NAME: table.tableName },
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });
    table.grantReadData(listIncidentsFn);
    alerts.addMethod('GET', new apigateway.LambdaIntegration(listIncidentsFn));

    // Get Incident Lambda
    const getIncidentFn = new lambda.Function(this, 'GetIncidentFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../backend/src/handlers/get-incident'),
      environment: { TABLE_NAME: table.tableName },
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });
    table.grantReadData(getIncidentFn);

    const alertId = alerts.addResource('{id}');
    alertId.addMethod('GET', new apigateway.LambdaIntegration(getIncidentFn));
    const ack = alertId.addResource('ack');
    ack.addMethod('POST', new apigateway.LambdaIntegration(resolveFn));

    // Output the API URL after deploy
    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url });
  }
}