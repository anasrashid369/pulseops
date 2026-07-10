import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as logs from 'aws-cdk-lib/aws-logs';

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB table
    const table = new dynamodb.Table(this, 'IncidentsTable', {
      tableName: 'PulseOpsIncidents',
      partitionKey: { name: 'incidentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // ok for a dev project
    });

  // Ingest Lambda
    const ingestFn = new lambda.Function(this, 'IngestAlertFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../backend/src/handlers/ingest-alert'),
      environment: {
        TABLE_NAME: table.tableName,
        TEST_DEVICE_TOKEN: 'eGQuj4deQtWirYJokaZFA8:APA91bFcNYA-NkQ-h45PV7kEZpnxWNwma82YkLSwLisEgONDD95jgNXXQL0DXoOGP7u-FldMKmVOAKU4PN9zHcWBKfaOwz8nNKIPwRSR2ZiOpkdcQ9FVq74',
      },
      timeout: cdk.Duration.seconds(15),
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });
    table.grantWriteData(ingestFn);
    ingestFn.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/pulseops/fcm-service-account`],
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

    const alertId = alerts.addResource('{id}');
    const ack = alertId.addResource('ack');
    ack.addMethod('POST', new apigateway.LambdaIntegration(resolveFn));

    // Output the API URL after deploy
    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url });
  }
}