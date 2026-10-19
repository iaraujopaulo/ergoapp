// Configuration settings that can be easily modified
export const config = {
  // Model configuration
  modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task',
  delegate: 'GPU',
  
  // Number of poses to detect
  numPoses: 3,
  
  // Additional detection parameters
  minPoseDetectionConfidence: 0.5,
  minPosePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
  outputSegmentationMasks: false,
  
  // Canvas drawing options
  landmarkOptions: {
    color: '#F43F5E',
    lineWidth: 2
  },
  
  // Connection options
  connectionOptions: {
    color: '#22D3EE',
    lineWidth: 1
  }
};