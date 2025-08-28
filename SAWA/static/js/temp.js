// ==========================
// GLOBALS & INITIALIZATION
// ==========================
const APP_ID = "2f3d920faaa7487ebf90616924df5b59";
let TOKEN = null;
const CHANNEL = sessionStorage.getItem("room");
let UID = sessionStorage.getItem("UID");
let NAME = sessionStorage.getItem("name");
let localUserStatus = { micMuted: false, videoMuted: false };

const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

let localTracks = [];
let remoteUsers = {};
let screenTrack = null;
let isScreenSharing = false;

// ------------------------------------------ Dubbing ------------------------------------------

let isDubbingEnabled = false; // Global dubbing state
let dubbingMode = "fast"; // "fast" for STT+TTS, "accurate" for dubbing
let userAudioProcessors = {}; // Store audio processing info for each user
let activeRecorders = {}; // Store active recorders for each user
let dubbingQueue = {}; // Queue for dubbing requests per user
let isProcessingDubbing = {}; // Track if dubbing is being processed for each user

// ------------------------------------------ Captions ------------------------------------------

let recognition = null;
let isCaptionsEnabled = false;
if ("webkitSpeechRecognition" in window) {
  recognition = new webkitSpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
}

// ==========================
// AGORA CLIENT EVENTS
// ==========================

client.on("user-joined", async (user) => {
  // Only add if not already present
  if (!document.getElementById(`user-container-${user.uid}`)) {
    let member = await getMember(user);
    remoteUsers[user.uid] = user;
    remoteUsers[user.uid].displayName = member.name;

    let player = `<div class="video-container" id="user-container-${user.uid}">
      <div class="video-player" id="user-${user.uid}"></div>
      <div class="username-wrapper"><span class="user-name">${member.name}</span></div>
      <div class="captions-container" id="captions-${user.uid}"></div>
    </div>`;

    document
      .getElementById("video-streams")
      .insertAdjacentHTML("beforeend", player);

    // Show placeholder immediately (no video track yet)
    await updateRemoteVideoContainer(user.uid, member);

    updateGridLayout();
    viewParticipants();
  }
});

let getMember = async (user) => {
  let response = await fetch(
    `/meetings/get_member/?UID=${user.uid}&room_name=${CHANNEL}`
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  let member = await response.json();
  return member;
};

client.on("user-unpublished", (user, mediaType) => {
  // Remove the track reference so status is correct
  if (mediaType === "audio") {
    remoteUsers[user.uid].audioTrack = null;
  }
  if (mediaType === "video") {
    remoteUsers[user.uid].videoTrack = null;
    updateRemoteVideoContainer(user.uid);
  }
  viewParticipants();
});

client.on("user-published", (user, mediaType) => {
  // The handleUserJoined will update the track reference
  // But we can also call viewParticipants here for instant update
  setTimeout(viewParticipants, 100); // slight delay to ensure track is set
});

// ==========================
// LAYOUT & PARTICIPANTS
// ==========================

// Function to update grid layout
const updateGridLayout = () => {
  const videoStreams = document.getElementById("video-streams");
  const participantCount = videoStreams.children.length;
  videoStreams.className = `participants-${participantCount}`;
  document.body.classList.toggle(
    "single-participant-mode",
    participantCount === 1
  );
};


function viewParticipants() {
  const participantsList = document.getElementById("participants-list");
  participantsList.innerHTML = "";

  // SVGs for icons
  const micOn = `<img style="width:18px;height:18px;" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAACXBIWXMAAAsTAAALEwEAmpwYAAABb0lEQVR4nO1VS0oDQRBtsva3j+AHdS0KCoqpTuLCla66SpOz6FxDcgMJEff5dEVdeABBvIIa0fEAIzWfZJRMMjHBVQqaGd5U1atX012tVAoDW17UjFVtyZUFFms5PltPE5sqOVjqaCYvvgQrNEx2bAItlf9KHiO5Gp/AkptIwPQxAQXkDVpTAjVt0f+2SDN9SdDe/fFshIHFzzTn4OihPOfjltxEArD4HJxQsxnDaskKsBr5Fdq4FWJPgxRUwhFwHmHFW9oAprd+swisWevFohPil4kEOcZ8KPNFJHera5iszB1pV9AyrMaTgz1Z6BbRMpBI4DszcVAJ1pTnZNQw85wMMN6EMc2h/mBpWVt8D5Tg9WHdzCf7SuVRcurkm6UllcZ063S3dwfgq2a6kJ8I1szIDsu3zLb0PGqLPAtts6NGseJdaRUYG8POgWaqH7TNykjJf6rBfdldwPjY2//+e0W+/TlxXzKe0B0wJVAx+wYVT7GGVb/1YAAAAABJRU5ErkJggg==" alt="microphone">`;
  const micOff = `<img style="width:18px;height:18px;" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAACXBIWXMAAAsTAAALEwEAmpwYAAABX0lEQVR4nO1Vy0oDMRQNXfvoXsEH6loUdNGFuOuqyT0ln6PzG+IfyDDiXgU/oiD+glrRSp0mXUQyZoYonWm0xdUELgOXe8+550wejAWsIdGqBmIFDGxoIBkB2yG9QeCKqK8B44fNDaVcmZlAA/FP8CKILmYmUF+WTCRQRK/zUGCqoiZgtUX/a5EierdNptNZ9HJvIefAtNtLWQ4YVE37kBVxvuvlkgoFsTfInjvd91UE567oJM+NhNhRwPOkuyiVcsvrjZyCs1KCMXDsmh+t5DxvLzV771i7nGWxD244bxZDCHFUSpBJBe7clImJokZlsQWPooYGrtz0t9PqWcr5ugJeHMmlkXK5FJzzZgFO1P8A1ljI0t3uYf4GKOBJA6f2JxopF+wO00LsW89zW7KvEAdB4IUSYFMR3Uw7B4roOpVy41fg39QArWx3EfW8h6bndlzrz8AlZGYub0BNwLz1CS6X6eDd8VgNAAAAAElFTkSuQmCC" alt="microphone">`;
  const videoOn = `<img width="18px" height="18px" src="https://img.icons8.com/android/24/40C057/video-call.png" alt="video-call"/>`;
  const videoOff = `<img width="18px" height="18px" src="https://img.icons8.com/android/24/FA5252/video-call.png" alt="video-call"/>`;

  // Local user
  if (NAME && UID) {
    const micStatus = localUserStatus.micMuted ? micOff : micOn;
    const videoStatus = localUserStatus.videoMuted ? videoOff : videoOn;
    const localDiv = document.createElement("div");
    localDiv.className = "participant-item";
    localDiv.innerHTML = `${NAME} (You) ${micStatus} ${videoStatus}`;
    participantsList.appendChild(localDiv);
  }


  // Remote users
  Object.values(remoteUsers).forEach((user) => {
    let micStatus = micOn, videoStatus = videoOn;
    if (!user.audioTrack || user.audioTrack.muted) micStatus = micOff;
    if (!user.videoTrack || user.videoTrack.muted) videoStatus = videoOff;
    const userDiv = document.createElement("div");
    userDiv.className = "participant-item";
    userDiv.innerHTML = `${user.displayName || `User ${user.uid}`} ${micStatus} ${videoStatus}`;
    participantsList.appendChild(userDiv);
  });
}

// ==========================
// MIC & VIDEO SETTINGS
// ==========================


let toggleMic = async (e) => {
  if (localTracks[0].muted) {
    await localTracks[0].setMuted(false);
    localUserStatus.micMuted = false;
    e.target.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
  } else {
    await localTracks[0].setMuted(true);
    localUserStatus.micMuted = true;
    e.target.style.backgroundColor = "var(--danger-red)";
  }
  setTimeout(viewParticipants, 100);
};

let toggleCamera = async (e) => {
  if (localTracks[1].muted) {
    await localTracks[1].setMuted(false);
    localUserStatus.videoMuted = false;
    e.target.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
    updateLocalVideoContainer();
  } else {
    await localTracks[1].setMuted(true);
    localUserStatus.videoMuted = true;
    e.target.style.backgroundColor = "var(--danger-red)";
    updateLocalVideoContainer();
  }
  viewParticipants();
};

// ==========================
// CAPTIONS (TO BE IMPLEMENTED)
// ==========================

let toggleCaptions = () => {
  if (!recognition) {
    showError("Speech recognition is not supported in your browser");
    return;
  }
  if (!isCaptionsEnabled) {
    recognition.start();
    document.getElementById("captions-btn").classList.add("active");
    isCaptionsEnabled = true;
  } else {
    recognition.stop();
    document.getElementById("captions-btn").classList.remove("active");
    isCaptionsEnabled = false;
  }
};

// ==========================
// SCREEN SHARING
// ==========================

let toggleScreenShare = async () => {
  const screenShareBtn = document.getElementById("screen-share-btn");
  if (!isScreenSharing) {
    try {
      screenShareBtn.disabled = true;
      screenTrack = await AgoraRTC.createScreenVideoTrack({
        encoderConfig: { width: { max: 1920 }, height: { max: 1080 }, frameRate: 30, bitrateMax: 1000 },
      });
      screenTrack.on("track-ended", () => stopScreenShare());
      await client.unpublish([localTracks[1]]);
      await client.publish([screenTrack]);
      const videoPlayer = document.getElementById(`user-${UID}`);
      if (videoPlayer) {
        localTracks[1].stop();
        screenTrack.play(videoPlayer);
        isScreenSharing = true;
        screenShareBtn.classList.add("active");
      }
    } catch (error) {
      console.error("Error sharing screen:", error);
      showError(error.message === "Permission denied" ? "Screen share permission denied" : "Failed to share screen");
      stopScreenShare();
    } finally {
      screenShareBtn.disabled = false;
    }
  } else {
    await stopScreenShare();
  }
};

async function stopScreenShare() {
  const screenShareBtn = document.getElementById("screen-share-btn");
  try {
    if (screenTrack) {
      await client.unpublish([screenTrack]);
      await client.publish([localTracks[1]]);
      const videoPlayer = document.getElementById(`user-${UID}`);
      if (videoPlayer) {
        screenTrack.stop();
        localTracks[1].play(videoPlayer);
      }
      screenTrack.close();
      screenTrack = null;
    }
  } catch (error) {
    console.error("Error stopping screen share:", error);
    showError("Failed to stop screen sharing");
  } finally {
    isScreenSharing = false;
    screenShareBtn.classList.remove("active");
    screenShareBtn.disabled = false;
  }
}

// ==========================
// DUBBING CONTROLS & LOGIC
// ==========================

let toggleDubbing = () => {
  const dubbingBtn = document.getElementById("dubbing-btn");
  if (!dubbingBtn) {
    console.error("Dubbing button not found!");
    return;
  }
  isDubbingEnabled = !isDubbingEnabled;
  if (isDubbingEnabled) {
    if (Object.keys(userAudioProcessors).length === 0) {
      const setupSuccess = setupLocalUserAudio();
      if (setupSuccess) {
        startDubbingForAllUsers();
        dubbingBtn.classList.add("active");
        showSuccess("Live dubbing enabled - Fast Arabic to English translation active");
      } else {
        isDubbingEnabled = false;
        dubbingBtn.classList.remove("active");
        showError("Failed to set up audio processing. Please check microphone permissions and try again.");
      }
    } else {
      startDubbingForAllUsers();
      dubbingBtn.classList.add("active");
      showSuccess("Live dubbing enabled - Fast Arabic to English translation active");
    }
  } else {
    dubbingBtn.classList.remove("active");
    showSuccess("Live dubbing disabled - Normal audio playback");
    Object.keys(userAudioProcessors).forEach((userId) => stopDubbingForUser(userId));
  }
};

function startDubbingForAllUsers() {
  Object.keys(userAudioProcessors).forEach((userId) => {
    try { startDubbingForUser(userId); }
    catch (error) { console.error(`Failed to start dubbing for user ${userId}:`, error); }
  });
}
window.toggleDubbing = toggleDubbing;

// ==========================
// ERROR & SUCCESS HELPERS
// ==========================
const showError = (message) => {
  const errorElement = document.getElementById("error-message");
  if (errorElement) {
    errorElement.textContent = message;
    errorElement.style.display = "block";
    errorElement.style.background = "var(--danger-red)";
    setTimeout(() => { errorElement.style.display = "none"; }, 5000);
  }
};
const showSuccess = (message) => {
  const errorElement = document.getElementById("error-message");
  if (errorElement) {
    errorElement.textContent = message;
    errorElement.style.display = "block";
    errorElement.style.background = "#34a853";
    setTimeout(() => { errorElement.style.display = "none"; }, 3000);
  }
};

// ==========================
// EVENT LISTENERS
// ==========================
// --- Main controls ---
document.getElementById("leave-btn").addEventListener("click", leaveAndRemoveLocalStream);
document.getElementById("camera-btn").addEventListener("click", toggleCamera);
document.getElementById("mic-btn").addEventListener("click", toggleMic);
document.getElementById("screen-share-btn").addEventListener("click", toggleScreenShare);
document.getElementById("captions-btn").addEventListener("click", toggleCaptions);

// --- Dubbing button (delayed for DOM load) ---
setTimeout(() => {
  const dubbingBtn = document.getElementById("dubbing-btn");
  if (dubbingBtn && !dubbingBtn.hasEventListener) {
    dubbingBtn.addEventListener("click", toggleDubbing);
    dubbingBtn.hasEventListener = true;
  }
}, 1000);

// --- DOMContentLoaded for additional controls ---
document.addEventListener("DOMContentLoaded", () => {
  // Dubbing
  const dubbingBtn = document.getElementById("dubbing-btn");
  if (dubbingBtn && !dubbingBtn.hasEventListener) {
    dubbingBtn.addEventListener("click", toggleDubbing);
    dubbingBtn.hasEventListener = true;
  }
  // Screen share
  const screenShareBtn = document.getElementById("screen-share-btn");
  if (screenShareBtn && !screenShareBtn.hasEventListener) {
    screenShareBtn.addEventListener("click", toggleScreenShare);
    screenShareBtn.hasEventListener = true;
  }
  // Captions
  const captionsBtn = document.getElementById("captions-btn");
  if (captionsBtn && !captionsBtn.hasEventListener) {
    captionsBtn.addEventListener("click", toggleCaptions);
    captionsBtn.hasEventListener = true;
  }
  // Language select
  const languageSelect = document.getElementById("user-language");
  if (languageSelect) {
    languageSelect.addEventListener("change", (e) => {
      window.userLanguage = e.target.value;
      showSuccess("Language set to " + (e.target.value === "en" ? "English" : "Arabic"));
    });
  }
  // Translate captions toggle
  const iconOff = document.getElementById("translate-captions-icon-off");
  const iconOn = document.getElementById("translate-captions-icon-on");
  if (iconOff && iconOn) {
    let translateOn = false;
    function toggleTranslate() {
      translateOn = !translateOn;
      iconOff.style.display = translateOn ? "none" : "inline";
      iconOn.style.display = translateOn ? "inline" : "none";
      window.translateCaptions = translateOn;
      showSuccess("Translate captions " + (translateOn ? "enabled" : "disabled"));
    }
    iconOff.addEventListener("click", toggleTranslate);
    iconOn.addEventListener("click", toggleTranslate);
  }
  // Dubbing mode select
  const dubbingModeSelect = document.getElementById("dubbing-mode-select");
  if (dubbingModeSelect) {
    dubbingModeSelect.value = dubbingMode;
    dubbingModeSelect.addEventListener("change", (e) => {
      dubbingMode = e.target.value;
      showSuccess(
        dubbingMode === "fast"
          ? "Fast mode: STT+TTS translation"
          : "Accurate mode: Full dubbing translation"
      );
    });
  }
});

// ==========================
// JOIN/LEAVE/STREAM LOGIC
// ==========================
let handleUserJoined = async (user, mediaType) => {
  console.log("User joined:", user.uid);
  remoteUsers[user.uid] = user;

  try {
    await client.subscribe(user, mediaType);
    console.log("Subscribed to user:", user.uid, mediaType);

    if (mediaType === "video") {
      let player = document.getElementById(`user-container-${user.uid}`);
      if (player != null) {
        player.remove();
      }

      let member = await getMember(user);
      console.log("Got member info:", member);

      remoteUsers[user.uid].displayName = member.name;

      player = `<div class="video-container" id="user-container-${user.uid}">
            <div class="video-player" id="user-${user.uid}"></div>
            <div class="username-wrapper"><span class="user-name">${member.name}</span></div>
            <div class="captions-container" id="captions-${user.uid}"></div>
        </div>`;

      document
        .getElementById("video-streams")
        .insertAdjacentHTML("beforeend", player);
      user.videoTrack.play(`user-${user.uid}`);

      await updateRemoteVideoContainer(user.uid, member);

      updateGridLayout();
      viewParticipants();
    }

    if (mediaType === "audio") {
      const audioContext = new (window.AudioContext ||
        window.webkitAudioContext)();
      const mediaStream = new MediaStream();
      mediaStream.addTrack(user.audioTrack.getMediaStreamTrack());

      const sourceNode = audioContext.createMediaStreamSource(mediaStream);
      const destination = audioContext.createMediaStreamDestination();
      sourceNode.connect(destination);

      // Store audio processing info for this user
      userAudioProcessors[user.uid] = {
        audioContext,
        sourceNode,
        destination,
        mediaStream,
        audioTrack: user.audioTrack,
      };

      // Start dubbing if it's enabled, otherwise play normally
      if (isDubbingEnabled) {
        startDubbingForUser(user.uid);
      } else {
        user.audioTrack.play();
      }
    }
  } catch (error) {
    console.error("Error in handleUserJoined:", error);
  }
};

let handleUserLeft = async (user) => {
  delete remoteUsers[user.uid];

  // Clean up audio processing for this user
  if (userAudioProcessors[user.uid]) {
    stopDubbingForUser(user.uid);
    delete userAudioProcessors[user.uid];
  }

  const container = document.getElementById(`user-container-${user.uid}`);
  if (container) {
    container.remove();
    updateGridLayout();
  }
  viewParticipants();
};

let getToken = async () => {
  try {
    const response = await fetch(`/meetings/get_token/?channel=${CHANNEL}&uid=${UID}`);
    if (!response.ok) throw new Error((await response.json()).error || `HTTP error! status: ${response.status}`);
    const data = await response.json();
    if (!data.token) throw new Error("No token received from server");
    if (data.uid && data.uid !== UID) {
      UID = data.uid.toString();
      sessionStorage.setItem("UID", UID);
    }
    return data.token;
  } catch (error) {
    console.error("Error getting token:", error);
    throw error;
  }
};

let createMember = async () => {
  // Get CSRF token from cookie
  function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== "") {
      const cookies = document.cookie.split(";");
      for (let i = 0; i < cookies.length; i++) {
        const cookie = cookies[i].trim();
        if (cookie.substring(0, name.length + 1) === name + "=") {
          cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
          break;
        }
      }
    }
    return cookieValue;
  }
  const csrftoken = getCookie("csrftoken");

  let response = await fetch("/meetings/create_member/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrftoken,
    },
    body: JSON.stringify({ name: NAME, room_name: CHANNEL, UID: UID }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  let member = await response.json();

  // addParticipantToDOM(member);

  viewParticipants();

  return member;
};

let joinAndDisplayLocalStream = async () => {
  try {
    if (!CHANNEL || !UID || !NAME) throw new Error("Missing session data: " + JSON.stringify({ CHANNEL, UID, NAME }));
    client.on("user-published", handleUserJoined);
    client.on("user-left", handleUserLeft);
    client.on("connection-state-change", (curState, prevState) => {
      console.log("Connection state changed:", prevState, "to", curState);
    });
    TOKEN = await getToken();
    if (!TOKEN) throw new Error("Failed to get token");
    await client.join(APP_ID, CHANNEL, TOKEN, UID);
    localTracks = await AgoraRTC.createMicrophoneAndCameraTracks();
    localUserStatus.micMuted = localTracks[0].muted;
    localUserStatus.videoMuted = localTracks[1].muted;
    viewParticipants();
    let member = await createMember();
    let player = `<div class="video-container" id="user-container-${UID}">
                    <div class="video-player" id="user-${UID}"></div>
                    <div class="username-wrapper"><span class="user-name">${member.name}</span></div>
                    <div class="captions-container" id="captions-${UID}"></div>
                  </div>`;
    document.getElementById("video-streams").insertAdjacentHTML("beforeend", player);
    localTracks[1].play(`user-${UID}`);
    await client.publish([localTracks[0], localTracks[1]]);
    setupLocalUserAudio();
    const dubbingBtn = document.getElementById("dubbing-btn");
    if (dubbingBtn && !dubbingBtn.hasEventListener) {
      dubbingBtn.addEventListener("click", toggleDubbing);
      dubbingBtn.hasEventListener = true;
    }
    updateGridLayout();
  } catch (error) {
    console.error("Error in joinAndDisplayLocalStream:", error);
    const errorMessage = document.getElementById("error-message");
    if (errorMessage) {
      errorMessage.textContent = `Error joining meeting: ${error.message}`;
      errorMessage.style.display = "block";
    }
    throw error;
  }
};

let deleteMember = async () => {
  // Get CSRF token from cookie
  function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== "") {
      const cookies = document.cookie.split(";");
      for (let i = 0; i < cookies.length; i++) {
        const cookie = cookies[i].trim();
        if (cookie.substring(0, name.length + 1) === name + "=") {
          cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
          break;
        }
      }
    }
    return cookieValue;
  }
  const csrftoken = getCookie("csrftoken");

  let response = await fetch("/meetings/delete_member/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrftoken,
    },
    body: JSON.stringify({ name: NAME, room_name: CHANNEL, UID: UID }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  viewParticipants();
  if (data.status === "host_left") {
    window.open("/dashboard", "_self");
    return data;
  }
  
  return data;
};

let leaveAndRemoveLocalStream = async () => {
  if (userAudioProcessors[UID]) {
    stopDubbingForUser(UID);
    delete userAudioProcessors[UID];
  }
  for (let i = 0; localTracks.length > i; i++) {
    localTracks[i].stop();
    localTracks[i].close();
  }
  await client.leave();
  const response = await deleteMember();
  window.open("/dashboard", "_self");
};

window.addEventListener("beforeunload", deleteMember);
joinAndDisplayLocalStream();

// ==========================
// REMOTE/LOCAL VIDEO CONTAINER HELPERS
// ==========================

async function updateLocalVideoContainer() {
  const container = document.getElementById(`user-container-${UID}`);
  if (!container) return;
  const videoPlayer = container.querySelector(".video-player");
  const placeholderClass = "video-placeholder";
  if (localUserStatus.videoMuted) {
    // Remove video player if exists
    if (videoPlayer) videoPlayer.style.display = "none";
    // Add placeholder if not exists
    if (!container.querySelector(`.${placeholderClass}`)) {
      // Fetch user info (profile picture and gender)
      let profilePic = null;
      let gender = "M";
      try {
        const resp = await fetch(`/meetings/get_member/?UID=${UID}&room_name=${CHANNEL}`);
        if (resp.ok) {
          const member = await resp.json();
          profilePic = member.profile_picture || null;
          gender = member.gender || "M";
        }
      } catch (e) {
        console.warn("Could not fetch user info for placeholder:", e);
      }

      const maleIcon = "/static/assets/img/male-avatar.png";
      const femaleIcon = "/static/assets/img/female-avatar.png";
      let imgSrc = profilePic
        ? profilePic
        : gender === "F"
        ? femaleIcon
        : maleIcon;


      const placeholder = document.createElement("div");
      placeholder.className = placeholderClass;
      placeholder.innerHTML = `
        <div class="video-placeholder-icon" style="background: #444; border-radius: 50%; width: 196px; height: 196px; margin: 0 auto 10px auto; display: flex; align-items: center; justify-content: center;">
          <img src="${imgSrc}" alt="User" style="width:172px;height:172px;object-fit:cover;opacity:0.85;border-radius:50%;">
        </div>
        <div class="video-placeholder-name">${NAME || "You"}</div>
      `;
      placeholder.style.display = "flex";
      placeholder.style.flexDirection = "column";
      placeholder.style.alignItems = "center";
      placeholder.style.justifyContent = "center";
      placeholder.style.width = "100%";
      placeholder.style.height = "100%";
      container.appendChild(placeholder);
    }
  } else {
    // Remove placeholder if exists
    const placeholder = container.querySelector(`.${placeholderClass}`);
    if (placeholder) placeholder.remove();
    // Show video player
    if (videoPlayer) videoPlayer.style.display = "";
    // Re-play video in case it was stopped
    localTracks[1].play(`user-${UID}`);
  }
}

async function updateRemoteVideoContainer(userId, memberInfo = null) {
  const container = document.getElementById(`user-container-${userId}`);
  if (!container) return;
  const videoPlayer = container.querySelector(".video-player");
  const placeholderClass = "video-placeholder";

  // Check if video is muted or not present
  const user = remoteUsers[userId];
  const isVideoMuted = !user || !user.videoTrack || user.videoTrack.muted;

  if (isVideoMuted) {
    if (videoPlayer) videoPlayer.style.display = "none";
    if (!container.querySelector(`.${placeholderClass}`)) {
      // Fetch user info if not provided
      let profilePic = null;
      let gender = "M";
      let name = `User ${userId}`;
      try {
        let member = memberInfo;
        if (!member) {
          const resp = await fetch(`/meetings/get_member/?UID=${userId}&room_name=${CHANNEL}`);
          if (resp.ok) {
            member = await resp.json();
          }
        }
        if (member) {
          profilePic = member.profile_picture || null;
          gender = member.gender || "M";
          name = member.name || name;
        }
      } catch (e) {
        console.warn("Could not fetch remote user info for placeholder:", e);
      }

      const maleIcon = "/static/assets/img/male-avatar.png";
      const femaleIcon = "/static/assets/img/female-avatar.png";
      let imgSrc = profilePic
        ? profilePic
        : gender === "F"
        ? femaleIcon
        : maleIcon;

      const placeholder = document.createElement("div");
      placeholder.className = placeholderClass;
      placeholder.innerHTML = `
        <div class="video-placeholder-icon" style="background: #444; border-radius: 50%; width: 196px; height: 196px; margin: 0 auto 10px auto; display: flex; align-items: center; justify-content: center;">
          <img src="${imgSrc}" alt="User" style="width:172px;height:172px;object-fit:cover;opacity:0.85;border-radius:50%;">
        </div>
        <div class="video-placeholder-name">${name}</div>
      `;
      placeholder.style.display = "flex";
      placeholder.style.flexDirection = "column";
      placeholder.style.alignItems = "center";
      placeholder.style.justifyContent = "center";
      placeholder.style.width = "100%";
      placeholder.style.height = "100%";
      container.appendChild(placeholder);
    }
  } else {
    // Remove placeholder if exists
    const placeholder = container.querySelector(`.${placeholderClass}`);
    if (placeholder) placeholder.remove();
    if (videoPlayer) videoPlayer.style.display = "";
    // Play video again if needed
    if (user && user.videoTrack) user.videoTrack.play(`user-${userId}`);
  }
}

// ==========================
// DUBBING CORE LOGIC (start/stop/process)
// ==========================

// Function to set up audio processing for local user
let setupLocalUserAudio = () => {
  console.log("=== SETUP LOCAL USER AUDIO ===");
  console.log("Local tracks:", localTracks);
  console.log("Local UID:", UID);

  if (!localTracks || !localTracks[0]) {
    console.warn("No audio track found for local user");
    console.log("Local tracks array:", localTracks);
    return false; // Return false to indicate failure
  }

  try {
    console.log("Creating audio context...");
    const audioContext = new (window.AudioContext ||
      window.webkitAudioContext)();

    console.log("Creating media stream...");
    const mediaStream = new MediaStream();
    mediaStream.addTrack(localTracks[0].getMediaStreamTrack());

    console.log("Creating audio nodes...");
    const sourceNode = audioContext.createMediaStreamSource(mediaStream);
    const destination = audioContext.createMediaStreamDestination();
    sourceNode.connect(destination);

    // Store audio processing info for local user
    userAudioProcessors[UID] = {
      audioContext,
      sourceNode,
      destination,
      mediaStream,
      audioTrack: localTracks[0],
      isLocal: true,
    };

    console.log("Successfully set up audio processing for local user:", UID);
    console.log("User audio processors now:", Object.keys(userAudioProcessors));
    return true; // Return true to indicate success
  } catch (error) {
    console.error("Error setting up local user audio:", error);
    return false; // Return false to indicate failure
  }
};

/* ------------------------------------------------------------------
   startDubbingForUser  – continuous, gap‑free audio capture
-------------------------------------------------------------------*/
function startDubbingForUser(userId) {
  if (!userAudioProcessors[userId]) {
    console.warn("No audio processor found for user:", userId);
    return;
  }

  const processor = userAudioProcessors[userId];

  // Mute the original remote audio while dubbing
  if (!processor.isLocal) {
    processor.audioTrack.stop();
  }

  /* ---------- Local user: sentence‑by‑sentence recorder ---------- */
  function startLocalSentenceDubbing() {
    let recorder = new MediaRecorder(processor.destination.stream, {
      mimeType: "audio/webm;codecs=opus",
    });

    let audioChunks = [];
    let recognition = null;
    let sentenceEndTimeout = null;
    let sentenceTranscript = "";

    recorder.ondataavailable = (event) => {
      audioChunks.push(event.data);
    };

    recorder.onstart = () => {
      audioChunks = [];

      // Speech‑recognition to find sentence boundaries
      if ("webkitSpeechRecognition" in window) {
        recognition = new webkitSpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "ar";
        sentenceTranscript = "";

        recognition.onresult = (event) => {
          let final = "";
          let interim = "";
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
              final += event.results[i][0].transcript;
            } else {
              interim += event.results[i][0].transcript;
            }
          }
          sentenceTranscript += final;

          if (isSentenceEnd(sentenceTranscript) || isSentenceEnd(interim)) {
            recognition.abort();
            if (recorder.state === "recording") recorder.stop();
          } else {
            clearTimeout(sentenceEndTimeout);
            sentenceEndTimeout = setTimeout(() => {
              recognition.abort();
              if (recorder.state === "recording") recorder.stop();
            }, 1200);
          }
        };

        recognition.onerror = () => {
          if (recorder.state === "recording") recorder.stop();
        };

        recognition.start();
      }
    };

    /*  🚀 Non‑blocking onstop: kick upload, then immediately restart recorder */
    recorder.onstop = () => {
      if (recognition) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition = null;
      }

      if (audioChunks.length) {
        const blob = new Blob(audioChunks, { type: "audio/webm" });
        isAudioLoudEnough(blob).then((isLoud) => {
          if (isLoud) {
            processDubbingAudio(blob, userId).catch((err) =>
              console.error("processDubbingAudio error:", err)
            );
          } else {
            console.log("⛔ Skipped local silent/low-volume chunk.");
          }
        });
      }

      // Restart instantly so we never miss speech
      if (isDubbingEnabled && userAudioProcessors[userId]) {
        startLocalSentenceDubbing();
      }
    };

    recorder.start();
  }

  /* ---------- Remote user: header‑safe 3‑second loop ---------- */
  function startRemoteDubbing() {
    let recorder;
    let stopLoop;

    const makeRecorder = () => {
      recorder = new MediaRecorder(processor.destination.stream, {
        mimeType: "audio/webm;codecs=opus",
      });

      activeRecorders[userId] = { recorder, stopLoop };

      recorder.ondataavailable = async (event) => {
        if (!isDubbingEnabled) return;
        if (event.data && event.data.size > 1000) {
          if (event.data && event.data.size > 1000) {
            const isLoud = await isAudioLoudEnough(event.data);
            if (isLoud) {
              await processDubbingAudio(event.data, userId);
            } else {
              console.log("Skipped silent/low-volume chunk.");
            }
          }
        }
      };

      recorder.onstop = () => {
        if (isDubbingEnabled && userAudioProcessors[userId]) {
          makeRecorder(); // fresh recorder, fresh header
        } else {
          delete activeRecorders[userId];
        }
      };

      recorder.start();
      const tid = setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 3000);

      stopLoop = () => {
        clearTimeout(tid);
        if (recorder.state === "recording") recorder.stop();
        delete activeRecorders[userId];
      };
    };

    makeRecorder();
  }

  /* ---------- Kick off appropriate path ---------- */
  processor.isLocal ? startLocalSentenceDubbing() : startRemoteDubbing();
}

// Separate function to process dubbing audio
async function processDubbingAudio(audioBlob, userId) {
  // Initialize queue for this user if it doesn't exist
  if (!dubbingQueue[userId]) {
    dubbingQueue[userId] = [];
    isProcessingDubbing[userId] = false;
  }

  // Add to queue
  dubbingQueue[userId].push(audioBlob);

  // Process queue if not already processing
  if (!isProcessingDubbing[userId]) {
    await processDubbingQueue(userId);
  }
}

// Process the dubbing queue for a specific user
async function processDubbingQueue(userId) {
  // If already working or nothing to do, exit early
  if (isProcessingDubbing[userId] || dubbingQueue[userId].length === 0) {
    return;
  }

  isProcessingDubbing[userId] = true;

  try {
    while (
      dubbingQueue[userId].length > 0 &&
      isDubbingEnabled &&
      userAudioProcessors[userId]
    ) {
      const audioBlob = dubbingQueue[userId].shift();

      // Skip chunks that are too small to matter
      if (audioBlob.size < 1000) {
        console.log(`Skipping small audio chunk for user ${userId}`);
        continue;
      }

      const formData = new FormData();
      formData.append("audio", audioBlob);
      formData.append("uid", userId);
      formData.append("room", CHANNEL);
      formData.append("mode", dubbingMode);

      // Include gender so the backend can pick a suitable voice
      const userGender = await getUserGender(userId);
      formData.append("user_gender", userGender);

      const selectedLang = window.userLanguage || "en"; // fallback to English
      formData.append("target_language", selectedLang);

      try {
        console.log(
          `Processing dubbing for user ${userId}, mode: ${dubbingMode}, gender: ${userGender}, audio size: ${audioBlob.size} bytes, queue length: ${dubbingQueue[userId].length}, target_language: ${selectedLang}`
        );

        const response = await fetch("/meetings/translate/audio/", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const errorData = await response.json();
          console.warn(`Dubbing request failed for user ${userId}:`, errorData);
          continue; // move on to next chunk
        }

        const data = await response.json();

        if (data.dubbed_audio_url) {
          /* ------------------------------------------------------------------
             Prevent the local speaker (host) from hearing their own dubbed voice
          ------------------------------------------------------------------ */
          const isLocalSpeaker =
            userId === UID && userAudioProcessors[userId]?.isLocal;

          if (!isLocalSpeaker) {
            const dubbedAudio = new Audio(data.dubbed_audio_url);
            dubbedAudio.volume = 0.8; // Slightly lower to avoid feedback
            dubbedAudio.oncanplaythrough = () =>
              dubbedAudio
                .play()
                .catch((err) =>
                  console.warn("Error playing dubbed audio:", err)
                );
          }

          /* -------- Temporary caption / status indicator -------- */
          const captionsContainer = document.getElementById(
            `captions-${userId}`
          );
          if (captionsContainer) {
            captionsContainer.textContent =
              dubbingMode === "fast"
                ? "⚡ Fast translating..."
                : "🔄 Accurate translating...";
            captionsContainer.classList.add("active");
            setTimeout(() => {
              captionsContainer.textContent = "";
              captionsContainer.classList.remove("active");
            }, 2000);
          }

          console.log(
            `Successfully processed dubbing for user ${userId} in ${dubbingMode} mode`
          );
        } else {
          console.warn("No dubbed audio URL received for user:", userId, data);
        }
      } catch (err) {
        console.error("Dubbing processing error for user:", userId, err);
      }
    }
  } finally {
    isProcessingDubbing[userId] = false; // always clear the flag
  }
}

// Helper function to get user gender (you can enhance this based on your user system)
async function getUserGender(userId) {
  try {
    // Get user gender from server
    const response = await fetch(`/get_user_gender/${userId}/`);
    if (response.ok) {
      const data = await response.json();
      return data.gender || "F"; // Default to female if not found
    }
  } catch (error) {
    console.warn("Could not fetch user gender:", error);
  }

  // Fallback to default gender
  return "F"; // Default to female voice
}

// Function to stop dubbing for a specific user
let stopDubbingForUser = (userId) => {
  if (!userAudioProcessors[userId]) {
    return;
  }

  // Stop the active recorder
  if (activeRecorders[userId]) {
    if (
      typeof activeRecorders[userId] === "object" &&
      activeRecorders[userId].stopLoop
    ) {
      // New structure with stopLoop function
      activeRecorders[userId].stopLoop();
    } else {
      // Old structure - direct recorder
      activeRecorders[userId].stop();
    }
    delete activeRecorders[userId];
  }

  // Clear dubbing queue for this user
  if (dubbingQueue[userId]) {
    dubbingQueue[userId] = [];
    isProcessingDubbing[userId] = false;
  }

  // For remote users, resume normal audio playback
  // For local users, their audio is already playing
  const processor = userAudioProcessors[userId];
  if (!processor.isLocal) {
    processor.audioTrack.play();
  }

  // Clear captions
  const captionsContainer = document.getElementById(`captions-${userId}`);
  if (captionsContainer) {
    captionsContainer.textContent = "";
    captionsContainer.classList.remove("active");
  }

  console.log("Stopped dubbing for user:", userId);
};


// ==========================
// UTILITY & TEST FUNCTIONS
// ==========================
function isSentenceEnd(text) {
  // Simple check for sentence-ending punctuation or long pause
  return /[.!?،؟]$/.test(text.trim());
}

async function isAudioLoudEnough(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  const rawData = audioBuffer.getChannelData(0);
  const sampleCount = rawData.length;
  let sumSquares = 0;

  for (let i = 0; i < sampleCount; i++) {
    sumSquares += rawData[i] * rawData[i];
  }

  const rms = Math.sqrt(sumSquares / sampleCount); // Root Mean Square amplitude

  return rms > 0.01; // ← adjust this threshold based on environment
}


// ==========================
// UI ICON HELPERS
// ==========================

 function updateMicIcon(isMuted) {
    const micOn = document.querySelector(".mic-on");
    const micOff = document.querySelector(".mic-off");
    if (isMuted) {
      micOn.style.display = "none";
      micOff.style.display = "block";
    } else {
      micOn.style.display = "block";
      micOff.style.display = "none";
    }
  }

  function updateCameraIcon(isOff) {
    const cameraOn = document.querySelector(".camera-on");
    const cameraOff = document.querySelector(".camera-off");
    if (isOff) {
      cameraOn.style.display = "none";
      cameraOff.style.display = "block";
    } else {
      cameraOn.style.display = "block";
      cameraOff.style.display = "none";
    }
  }



  ///====================================================

  