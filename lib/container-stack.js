"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContainerStack = void 0;
const cdk = require("aws-cdk-lib");
const ecrAssets = require("aws-cdk-lib/aws-ecr-assets");
const path = require("path");
class ContainerStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Build and push Docker image from Dockerfile
        // CDK manages the ECR repository automatically via DockerImageAsset
        const dockerImage = new ecrAssets.DockerImageAsset(this, 'DockerImage', {
            directory: path.join(__dirname, '../container'),
            platform: ecrAssets.Platform.LINUX_AMD64,
        });
        this.imageUri = dockerImage.imageUri;
        new cdk.CfnOutput(this, 'ImageUri', {
            value: this.imageUri,
            description: 'Container image URI',
            exportName: 'AtxContainerImageUri',
        });
    }
}
exports.ContainerStack = ContainerStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGFpbmVyLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiY29udGFpbmVyLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUNuQyx3REFBd0Q7QUFFeEQsNkJBQTZCO0FBRTdCLE1BQWEsY0FBZSxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBRzNDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsOENBQThDO1FBQzlDLG9FQUFvRTtRQUNwRSxNQUFNLFdBQVcsR0FBRyxJQUFJLFNBQVMsQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLEVBQUUsYUFBYSxFQUFFO1lBQ3RFLFNBQVMsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxjQUFjLENBQUM7WUFDL0MsUUFBUSxFQUFFLFNBQVMsQ0FBQyxRQUFRLENBQUMsV0FBVztTQUN6QyxDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsUUFBUSxHQUFHLFdBQVcsQ0FBQyxRQUFRLENBQUM7UUFFckMsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxVQUFVLEVBQUU7WUFDbEMsS0FBSyxFQUFFLElBQUksQ0FBQyxRQUFRO1lBQ3BCLFdBQVcsRUFBRSxxQkFBcUI7WUFDbEMsVUFBVSxFQUFFLHNCQUFzQjtTQUNuQyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFyQkQsd0NBcUJDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGVjckFzc2V0cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNyLWFzc2V0cyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5cbmV4cG9ydCBjbGFzcyBDb250YWluZXJTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSBpbWFnZVVyaTogc3RyaW5nO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogY2RrLlN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIC8vIEJ1aWxkIGFuZCBwdXNoIERvY2tlciBpbWFnZSBmcm9tIERvY2tlcmZpbGVcbiAgICAvLyBDREsgbWFuYWdlcyB0aGUgRUNSIHJlcG9zaXRvcnkgYXV0b21hdGljYWxseSB2aWEgRG9ja2VySW1hZ2VBc3NldFxuICAgIGNvbnN0IGRvY2tlckltYWdlID0gbmV3IGVjckFzc2V0cy5Eb2NrZXJJbWFnZUFzc2V0KHRoaXMsICdEb2NrZXJJbWFnZScsIHtcbiAgICAgIGRpcmVjdG9yeTogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2NvbnRhaW5lcicpLFxuICAgICAgcGxhdGZvcm06IGVjckFzc2V0cy5QbGF0Zm9ybS5MSU5VWF9BTUQ2NCxcbiAgICB9KTtcblxuICAgIHRoaXMuaW1hZ2VVcmkgPSBkb2NrZXJJbWFnZS5pbWFnZVVyaTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdJbWFnZVVyaScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmltYWdlVXJpLFxuICAgICAgZGVzY3JpcHRpb246ICdDb250YWluZXIgaW1hZ2UgVVJJJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdBdHhDb250YWluZXJJbWFnZVVyaScsXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==