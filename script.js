import { config } from './config.js';
import { displayLandmarkInfo } from './landmarks.js';

// Status do modelo (mostra ao usuário o que está acontecendo)
const modelStatus = document.getElementById("modelStatus");
function setStatus(state, text) {
  if (!modelStatus) return;
  modelStatus.className = `model-status ${state}`;
  modelStatus.innerHTML = text;
}
setStatus("loading", '<i class="fas fa-spinner fa-spin"></i> Carregando modelo de IA… isso pode levar alguns segundos.');

// Carrega a biblioteca do MediaPipe, tentando mais de uma CDN
const VISION_URLS = [
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/vision_bundle.mjs",
  "https://cdn.skypack.dev/@mediapipe/tasks-vision@0.10.0"
];
let PoseLandmarker, FilesetResolver, DrawingUtils;
let visionLoadError = null;
for (const url of VISION_URLS) {
  try {
    ({ PoseLandmarker, FilesetResolver, DrawingUtils } = await import(url));
    visionLoadError = null;
    break;
  } catch (err) {
    visionLoadError = err;
    console.warn("Falha ao carregar o MediaPipe de", url, err);
  }
}

// DOM elements
const demosSection = document.getElementById("demos");
const imageUpload = document.getElementById("imageUpload");
const videoUpload = document.getElementById("videoUpload");
const imageContainer = document.getElementById("imageContainer");
const resultContainer = document.getElementById("resultContainer");
const uploadHint = document.getElementById("uploadHint");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const imageResult = document.getElementById("imageResult");
const videoResult = document.getElementById("videoResult");
const videoElement = document.getElementById("video");
const videoControls = document.getElementById("videoControls");
const playPauseButton = document.getElementById("playPauseButton");
const nextFrameButton = document.getElementById("nextFrameButton");
const prevFrameButton = document.getElementById("prevFrameButton");
const frameCounter = document.getElementById("frameCounter");

// Variables
let poseLandmarker = undefined;
let runningMode = "IMAGE"; // This will be dynamically changed based on upload type
let uploadedImage = null;
let isVideoPlaying = false;
let videoAnimationFrame = null;
let lastVideoTime = -1;
let currentMedia = null; // Store the current media for drawing on canvas

// Initialize PoseLandmarker
const createPoseLandmarker = async () => {
  if (visionLoadError) {
    console.error("Error loading MediaPipe:", visionLoadError);
    setStatus("error", '<i class="fas fa-triangle-exclamation"></i> Não foi possível carregar a biblioteca do MediaPipe. Verifique sua conexão com a internet e recarregue a página.');
    return;
  }
  try {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
    );
    const buildOptions = (delegate) => ({
      baseOptions: {
        modelAssetPath: config.modelAssetPath,
        delegate: delegate
      },
      runningMode: runningMode,
      numPoses: config.numPoses,
      minPoseDetectionConfidence: config.minPoseDetectionConfidence,
      minPosePresenceConfidence: config.minPosePresenceConfidence,
      minTrackingConfidence: config.minTrackingConfidence,
      outputSegmentationMasks: config.outputSegmentationMasks
    });
    try {
      poseLandmarker = await PoseLandmarker.createFromOptions(vision, buildOptions(config.delegate));
    } catch (gpuError) {
      // Se a GPU não estiver disponível, tenta de novo usando a CPU
      console.warn("Falha com delegate", config.delegate, "- tentando CPU:", gpuError);
      poseLandmarker = await PoseLandmarker.createFromOptions(vision, buildOptions("CPU"));
    }
    setStatus("ready", '<i class="fas fa-circle-check"></i> Modelo pronto. Envie uma imagem ou um vídeo.');
    console.log("PoseLandmarker initialized successfully");
  } catch (error) {
    console.error("Error initializing PoseLandmarker:", error);
    setStatus("error", `<i class="fas fa-triangle-exclamation"></i> Não foi possível carregar o modelo de IA: ${error.message || error}`);
  }
};

// Start initialization
createPoseLandmarker();

// Handle image upload
imageUpload.addEventListener("change", async (event) => {
  if (event.target.files && event.target.files[0]) {
    // Wait for model to load if it hasn't already
    if (!poseLandmarker) {
      alert("Por favor, aguarde o modelo carregar! Deve levar 15 segundos");
      return;
    }

    demosSection.classList.remove("invisible");

    try {
      // Reset to IMAGE mode if needed
      if (runningMode !== "IMAGE") {
        runningMode = "IMAGE";
        await poseLandmarker.setOptions({ runningMode: "IMAGE" });
      }
      
      // Clear previous image and results
      while (imageContainer.firstChild) {
        imageContainer.removeChild(imageContainer.firstChild);
      }

      // Hide video result and show image result
      imageResult.style.display = "none"; 
      videoResult.style.display = "none";
      videoControls.style.display = "none";
      
      // Stop any ongoing video playback
      if (videoElement.played && !videoElement.paused) {
        videoElement.pause();
      }
      if (videoAnimationFrame) {
        cancelAnimationFrame(videoAnimationFrame);
        videoAnimationFrame = null;
      }

      // Show loading indicator
      imageContainer.innerHTML = '<div style="text-align:center;"><i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: #4f46e5;"></i><p>Processando imagem...</p></div>';

      // Display the uploaded image
      const file = event.target.files[0];
      const img = document.createElement("img");
      uploadedImage = img;
      img.src = URL.createObjectURL(file);
      img.onload = () => {
        // Adjust canvas size
        canvasElement.width = img.width;
        canvasElement.height = img.height;
        canvasElement.style.width = "100%";
        canvasElement.style.height = "auto";
        
        // Move image from container to result area
        imageContainer.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="font-size: 3rem; color: #4f46e5; margin-bottom: 15px;"></i><p id="uploadHint">Arquivo processado com sucesso! Após detectar a postura, responda o questionário abaixo!</p>';
        
        // Hide the image in imageResult since we'll draw it directly on canvas
        imageResult.innerHTML = '';
        imageResult.style.display = "none";
        
        // Process the image
        detectPose(img);
      };
    } catch (error) {
      console.error("Error switching to IMAGE mode:", error);
      alert("Error switching to image mode. Please try again.");
      return;
    }
    
  }
});

// Handle video upload
videoUpload.addEventListener("change", async (event) => {
  if (event.target.files && event.target.files[0]) {
    // Wait for model to load if it hasn't already
    if (!poseLandmarker) {
      alert("Por favor, aguarde o modelo carregar! Deve levar 15 segundos");
      return;
    }

    demosSection.classList.remove("invisible");

    try {
      // Reset to VIDEO mode if needed
      if (runningMode !== "VIDEO") {
        runningMode = "VIDEO";
        await poseLandmarker.setOptions({ runningMode: "VIDEO" });
      }
      
      // Clear previous media and results
      while (imageContainer.firstChild) {
        imageContainer.removeChild(imageContainer.firstChild);
      }

      // Clear previous canvas content
      canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
      
      // Clear any previous image results
      imageResult.innerHTML = '';
      
      // Show loading indicator
      imageContainer.innerHTML = '<div style="text-align:center;"><i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: #4f46e5;"></i><p>Processando vídeo...</p></div>';

      // Hide image result and show video result
      imageResult.style.display = "none";
      videoResult.style.display = "none"; 
      videoControls.style.display = "block";

      // Set up the video element
      const file = event.target.files[0];
      videoElement.src = URL.createObjectURL(file);
      
      videoElement.onloadedmetadata = () => {
        // Adjust canvas size
        canvasElement.width = videoElement.videoWidth;
        canvasElement.height = videoElement.videoHeight;
        canvasElement.style.width = "100%";
        canvasElement.style.height = "auto";
        
        // Reset container
        imageContainer.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="font-size: 3rem; color: #4f46e5; margin-bottom: 15px;"></i><p id="uploadHint">Arquivo processado com sucesso! Após detectar a postura, responda o questionario abaixo!</p>';
        
        // Update detection info
        const detectionInfo = document.getElementById("detectionInfo");
        detectionInfo.innerHTML = `
          <div style="display: flex; align-items: center; flex-wrap: wrap;">
            <i class="fas fa-info-circle" style="font-size: 1.5rem; color: #4f46e5; margin-right: 10px;"></i>
            <div>
              <p><strong>Media Type:</strong> Video</p>
              <p><strong>Running Mode:</strong> ${runningMode}</p>
              <p><strong>Duração:</strong> ${Math.round(videoElement.duration)} segundos</p>
            </div>
          </div>
        `;
        detectionInfo.style.display = "block";
      };

      // Analisa o primeiro frame assim que o vídeo carregar
      videoElement.onloadeddata = async () => {
        lastVideoTime = -1;
        nextFrameButton.disabled = false;
        prevFrameButton.disabled = false;
        await detectPoseInVideo();
        demosSection.scrollIntoView({ behavior: "smooth", block: "start" });
      };
      
      // Set up video controls
      videoControls.style.display = "block";
      playPauseButton.innerHTML = '<i class="fas fa-play"></i> Play';
      playPauseButton.dataset.state = "play";
      nextFrameButton.disabled = true;
      prevFrameButton.disabled = true;

    } catch (error) {
      console.error("Error switching to VIDEO mode:", error);
      alert("Error switching to video mode. Please try again.");
      return;
    }
    
  }
});


// Controles do vídeo (registrados uma única vez)
playPauseButton.addEventListener("click", () => {
  if (playPauseButton.dataset.state === "play") {
    videoElement.play();
    isVideoPlaying = true;
    playPauseButton.innerHTML = '<i class="fas fa-pause"></i> Pause';
    playPauseButton.dataset.state = "pause";
    nextFrameButton.disabled = true;
    prevFrameButton.disabled = true;
    requestVideoDetection();
  } else {
    videoElement.pause();
    isVideoPlaying = false;
    playPauseButton.innerHTML = '<i class="fas fa-play"></i> Play';
    playPauseButton.dataset.state = "play";
    nextFrameButton.disabled = false;
    prevFrameButton.disabled = false;
    if (videoAnimationFrame) {
      cancelAnimationFrame(videoAnimationFrame);
      videoAnimationFrame = null;
    }
  }
});

nextFrameButton.addEventListener("click", () => {
  if (!isVideoPlaying) {
    videoElement.currentTime += 1/30; // Advance ~1 frame (assuming 30fps)
    detectPoseInVideo();
  }
});

prevFrameButton.addEventListener("click", () => {
  if (!isVideoPlaying) {
    videoElement.currentTime -= 1/30; // Go back ~1 frame (assuming 30fps)
    detectPoseInVideo();
  }
});

videoElement.addEventListener("ended", () => {
  isVideoPlaying = false;
  playPauseButton.innerHTML = '<i class="fas fa-play"></i> Play';
  playPauseButton.dataset.state = "play";
  nextFrameButton.disabled = false;
  prevFrameButton.disabled = false;
  if (videoAnimationFrame) {
    cancelAnimationFrame(videoAnimationFrame);
    videoAnimationFrame = null;
  }
});

// Process video frames for pose detection
function requestVideoDetection() {
  if (!isVideoPlaying) return;
  
  detectPoseInVideo();
  videoAnimationFrame = requestAnimationFrame(requestVideoDetection);
}

// Detect pose in video
async function detectPoseInVideo() {
  if (!poseLandmarker) {
    console.log("Wait for poseLandmarker to load before processing!");
    return;
  }
  
  try {
    if (videoElement.currentTime !== lastVideoTime) {
      // Save current media for drawing on canvas
      currentMedia = videoElement;
      
      // Process the video frame with poseLandmarker
      const startTimeMs = performance.now();
      const results = await poseLandmarker.detectForVideo(videoElement, startTimeMs);
      lastVideoTime = videoElement.currentTime;
      
      // Update frame counter
      const fps = 30; // Estimated FPS
      const currentFrame = Math.floor(videoElement.currentTime * fps);
      const totalFrames = Math.floor(videoElement.duration * fps);
      frameCounter.textContent = `Frame: ${currentFrame}/${totalFrames}`;
      
      // Draw video frame on canvas first
      canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
      canvasCtx.drawImage(currentMedia, 0, 0, canvasElement.width, canvasElement.height);
      
      // Make canvas responsive with fixed aspect ratio
      const containerWidth = canvasElement.parentElement.clientWidth;
      canvasElement.style.width = `${containerWidth}px`;
      canvasElement.style.height = `${containerWidth * (canvasElement.height / canvasElement.width)}px`;
      
      const drawingUtils = new DrawingUtils(canvasCtx);
      
      // Draw landmarks and connections for each detected pose
      for (const landmark of results.landmarks) {
        drawingUtils.drawLandmarks(landmark, {
          radius: (data) => DrawingUtils.lerp(data.from?.z || 0, -0.15, 0.1, 5, 1),
          color: config.landmarkOptions.color,
          lineWidth: config.landmarkOptions.lineWidth
        });
        
        drawingUtils.drawConnectors(landmark, PoseLandmarker.POSE_CONNECTIONS, {
          color: config.connectionOptions.color,
          lineWidth: config.connectionOptions.lineWidth
        });
      }
      
      // Display landmark information below canvas
      if (results.landmarks.length > 0) {
        displayLandmarkInfo(results.landmarks[0], canvasElement.width, canvasElement.height);
        
        // If video is paused and has played a bit, show assessment form
        if (!isVideoPlaying && videoElement.currentTime > 0.5) {
          displayLandmarkInfo(results.landmarks[0], canvasElement.width, canvasElement.height);
        }
      } else {
        document.getElementById('landmarkInfo').style.display = 'none';
      }
    }
  } catch (error) {
    console.error("Error detecting pose in video:", error);
  }
}

// Detect pose in the image
async function detectPose(imageElement) {
  if (!poseLandmarker) {
    console.log("Wait for poseLandmarker to load before processing!");
    return;
  }

  try {
    // Save current media for drawing on canvas
    currentMedia = imageElement;
    
    // Process the image with poseLandmarker
    const result = await poseLandmarker.detect(imageElement);
    
    // Update detection info
    const detectionInfo = document.getElementById("detectionInfo");
    detectionInfo.innerHTML = `
      <div style="display: flex; align-items: center; flex-wrap: wrap;">
        <i class="fas fa-info-circle" style="font-size: 1.5rem; color: #4f46e5; margin-right: 10px;"></i>
        <div>
          <p><strong>Número de posturas detectadas:</strong> ${result.landmarks.length}</p>
          <p><strong>Running Mode:</strong> ${runningMode}</p>
        </div>
      </div>
    `;
    
    detectionInfo.style.display = "block";
    
    // Draw image on canvas first
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(currentMedia, 0, 0, canvasElement.width, canvasElement.height);
    
    // Make canvas responsive with fixed aspect ratio
    const containerWidth = canvasElement.parentElement.clientWidth;
    canvasElement.style.width = `${containerWidth}px`;
    canvasElement.style.height = `${containerWidth * (canvasElement.height / canvasElement.width)}px`;
    
    const drawingUtils = new DrawingUtils(canvasCtx);
    
    // Position canvas next to the image
    resultContainer.style.display = "flex";
    
    // Draw landmarks and connections for each detected pose
    for (const landmark of result.landmarks) {
      drawingUtils.drawLandmarks(landmark, {
        radius: (data) => DrawingUtils.lerp(data.from?.z || 0, -0.15, 0.1, 5, 1),
        color: config.landmarkOptions.color,
        lineWidth: config.landmarkOptions.lineWidth
      });
      
      drawingUtils.drawConnectors(landmark, PoseLandmarker.POSE_CONNECTIONS, {
        color: config.connectionOptions.color,
        lineWidth: config.connectionOptions.lineWidth
      });
    }
    
    // Display landmark information below canvas
    if (result.landmarks.length > 0) {

      displayLandmarkInfo(result.landmarks[0], imageElement.width, imageElement.height);
    } else {
      document.getElementById('landmarkInfo').style.display = 'none';
    }
    
    demosSection.scrollIntoView({ behavior: "smooth", block: "start" });

    // Show message if no poses detected
    if (result.landmarks.length === 0) {
      console.log("No poses detected in the image.");
    } else {
      console.log(`Detected ${result.landmarks.length} pose(s)`);
    }
    
  } catch (error) {
    console.error("Error detecting pose:", error);
    // Show error message to user
    const detectionInfo = document.getElementById("detectionInfo");
    detectionInfo.innerHTML = `
      <div style="display: flex; align-items: center; flex-wrap: wrap;">
        <i class="fas fa-exclamation-triangle" style="font-size: 1.5rem; color: #e11d48; margin-right: 10px;"></i>
        <div>
          <p><strong>Error processing image:</strong> ${error.message}</p>
          <p>Please try with a different image.</p>
        </div>
      </div>
    `;
    detectionInfo.style.display = "block";
    document.getElementById('landmarkInfo').style.display = 'none';
  }
}

// Add drag and drop functionality
imageContainer.addEventListener('dragover', (e) => {
  e.preventDefault();
  imageContainer.style.borderColor = '#4f46e5';
  imageContainer.style.backgroundColor = 'rgba(79, 70, 229, 0.08)';
});

imageContainer.addEventListener('dragleave', () => {
  imageContainer.style.borderColor = '#c9cde6';
  imageContainer.style.backgroundColor = 'transparent';
});

imageContainer.addEventListener('drop', (e) => {
  e.preventDefault();
  imageContainer.style.borderColor = '#c9cde6';
  imageContainer.style.backgroundColor = 'transparent';
  
  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
    const file = e.dataTransfer.files[0];
    
    if (file.type.startsWith('image/')) {
      imageUpload.files = e.dataTransfer.files;
      const event = new Event('change');
      imageUpload.dispatchEvent(event);
    } else if (file.type.startsWith('video/')) {
      videoUpload.files = e.dataTransfer.files;
      const event = new Event('change');
      videoUpload.dispatchEvent(event);
    }
  }
});
