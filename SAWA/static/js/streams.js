const APP_ID = "2f3d920faaa7487ebf90616924df5b59";
let TOKEN = null;
const CHANNEL = sessionStorage.getItem("room");
let UID = sessionStorage.getItem("UID");
let NAME = sessionStorage.getItem("name");
let localUserStatus = {
  micMuted: false,
  videoMuted: false,
};

const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

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

let localTracks = [];
let remoteUsers = {};
let screenTrack = null;
let isScreenSharing = false;
let isDubbingEnabled = false; // Global dubbing state
let dubbingMode = "fast"; // "fast" for STT+TTS, "accurate" for dubbing

// Track audio processing for each user
let userAudioProcessors = {}; // Store audio processing info for each user
let activeRecorders = {}; // Store active recorders for each user
let dubbingQueue = {}; // Queue for dubbing requests per user
let isProcessingDubbing = {}; // Track if dubbing is being processed for each user

// Initialize speech recognition for captions
let recognition = null;
let isCaptionsEnabled = false;
if ("webkitSpeechRecognition" in window) {
  recognition = new webkitSpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
}

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

console.log("Initial session data:", { CHANNEL, UID, NAME });

let getToken = async () => {
  try {
    console.log("Fetching token for:", { CHANNEL, UID });
    const response = await fetch(
      `/meetings/get_token/?channel=${CHANNEL}&uid=${UID}`
    );

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Token fetch error:", errorData);
      throw new Error(
        errorData.error || `HTTP error! status: ${response.status}`
      );
    }

    const data = await response.json();
    console.log("Token response:", {
      ...data,
      token: data.token ? "Present" : "Missing",
    });

    if (!data.token) {
      throw new Error("No token received from server");
    }

    // Update UID if server returned a different one
    if (data.uid && data.uid !== UID) {
      console.log("Updating UID from server:", data.uid);
      UID = data.uid.toString();
      sessionStorage.setItem("UID", UID);
    }

    return data.token;
  } catch (error) {
    console.error("Error getting token:", error);
    throw error;
  }
};

let joinAndDisplayLocalStream = async () => {
  try {
    if (!CHANNEL || !UID || !NAME) {
      throw new Error(
        "Missing session data: " + JSON.stringify({ CHANNEL, UID, NAME })
      );
    }



    client.on("user-published", handleUserJoined);
    client.on("user-left", handleUserLeft);
    client.on("connection-state-change", (curState, prevState) => {
      console.log("Connection state changed:", prevState, "to", curState);
    });

    console.log("Getting token...");
    TOKEN = await getToken();
    if (!TOKEN) {
      throw new Error("Failed to get token");
    }
    console.log("Token received, joining channel:", CHANNEL);

    try {
      await client.join(APP_ID, CHANNEL, TOKEN, UID);
      console.log("Successfully joined channel");
    } catch (joinError) {
      console.error("Error joining channel:", joinError);
      throw new Error(`Failed to join channel: ${joinError.message}`);
    }

    console.log("Creating local tracks...");
    try {
      localTracks = await AgoraRTC.createMicrophoneAndCameraTracks();

      const settings = await getUserSettings(UID);

      localUserStatus.micMuted = localTracks[0].muted;
      localUserStatus.videoMuted = localTracks[1].muted;
      viewParticipants();
      console.log("Local tracks created:", localTracks);
    } catch (mediaError) {
      console.error("Error creating media tracks:", mediaError);
      throw new Error(`Failed to create media tracks: ${mediaError.message}`);
    }

    try {
      let member = await createMember();
      console.log("Member created:", member);

      let player = `<div class="video-container" id="user-container-${UID}">
                    <div class="video-player" id="user-${UID}"></div>
                    <div class="username-wrapper"><span class="user-name">${member.name}</span></div>
                    <div class="captions-container" id="captions-${UID}"></div>
                  </div>`;

      document
        .getElementById("video-streams")
        .insertAdjacentHTML("beforeend", player);

      localTracks[1].play(`user-${UID}`);
      await client.publish([localTracks[0], localTracks[1]]);

      // Set up audio processing for local user
      setupLocalUserAudio();

      // Ensure dubbing button is properly set up
      const dubbingBtn = document.getElementById("dubbing-btn");
      if (dubbingBtn && !dubbingBtn.hasEventListener) {
        dubbingBtn.addEventListener("click", toggleDubbing);
        dubbingBtn.hasEventListener = true;
        console.log("Dubbing button event listener added after stream setup");
      }

      updateGridLayout();
    } catch (error) {
      console.error("Error in stream setup:", error);
      throw new Error(`Failed to setup stream: ${error.message}`);
    }
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

async function getUserSettings(userId) {
  try {
    const response = await fetch(`/get_user_settings/${userId}/`);
    if (response.ok) {
      const data = await response.json();
      // Update mic and camera mute status based on retrieved settings
      await setMicMuted(data.mic);
      await setCameraMuted(data.video);
      return data;
    } else {
      console.error(
        `Error fetching user settings: ${response.status} - ${response.statusText}`
      );
      await setMicMuted(true);
      await setCameraMuted(true);
    }
  } catch (error) {
    console.warn("Could not fetch user settings:", error);
    await setMicMuted(true);
    await setCameraMuted(true);
  }
}

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

let leaveAndRemoveLocalStream = async () => {
  // Clean up local user's audio processor
  if (userAudioProcessors[UID]) {
    stopDubbingForUser(UID);
    delete userAudioProcessors[UID];
  }

  for (let i = 0; localTracks.length > i; i++) {
    localTracks[i].stop();
    localTracks[i].close();
  }

  await client.leave();

  // Check if current user is the host before deleting member
  const response = await deleteMember();

  // If host left, show message and redirect
  if (response && response.status === "host_left") {
    // alert("Host ended the meeting");
    window.open("/dashboard", "_self");
  } else {
    window.open("/dashboard", "_self");
  }
};

let toggleCamera = async (e) => {
  // Check the current muted state of the video track
  const isMuted = localTracks[1].muted;
  // Set the track to the opposite state
  await localTracks[1].setMuted(!isMuted);
  localUserStatus.videoMuted = !isMuted;

  // Add or remove the 'active' class on the button for styling
  cameraBtn.classList.toggle("active", !isMuted);

  // Update the icon to show the correct state
  updateCameraIcon(!isMuted);

  // Update the local video and participant views
  updateLocalVideoContainer();
  viewParticipants();
};

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
        const resp = await fetch(
          `/meetings/get_member/?UID=${UID}&room_name=${CHANNEL}`
        );
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
          const resp = await fetch(
            `/meetings/get_member/?UID=${userId}&room_name=${CHANNEL}`
          );
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

let setMicMuted = async (mute) => {
  await localTracks[0].setMuted(mute);
  localUserStatus.micMuted = mute;

  // Corrected line: Pass the 'mute' variable
  updateMicIcon(mute);

  setTimeout(viewParticipants, 100);
};

let toggleMic = async (e) => {
  // Check the current muted state of the audio track
  const isMuted = localTracks[0].muted;
  // Set the track to the opposite state
  await localTracks[0].setMuted(!isMuted);
  localUserStatus.micMuted = !isMuted;

  // Add or remove the 'active' class on the button for styling
  micBtn.classList.toggle("active", !isMuted);

  // Update the icon to show the correct state
  updateMicIcon(!isMuted);

  // Update the participant view
  viewParticipants();
};

const micBtn = document.getElementById("mic-btn");
const cameraBtn = document.getElementById("camera-btn");

// --- Icon Update Functions ---
function updateMicIcon(isMuted) {
  const micOn = micBtn.querySelector(".mic-on");
  const micOff = micBtn.querySelector(".mic-off");
  if (isMuted) {
    micOn.style.display = "none";
    micOff.style.display = "block";
  } else {
    micOn.style.display = "block";
    micOff.style.display = "none";
  }
}

function updateCameraIcon(isOff) {
  const cameraOn = cameraBtn.querySelector(".camera-on");
  const cameraOff = cameraBtn.querySelector(".camera-off");
  if (isOff) {
    cameraOn.style.display = "none";
    cameraOff.style.display = "block";
  } else {
    cameraOn.style.display = "block";
    cameraOff.style.display = "none";
  }
}

let setCameraMuted = async (mute) => {
  await localTracks[1].setMuted(mute);
  localUserStatus.videoMuted = mute;
  updateCameraIcon(mute);
  setTimeout(viewParticipants, 100);
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

function viewParticipants() {
  const participantsList = document.getElementById("participants-list");
  participantsList.innerHTML = ""; // Clear current list

  // SVGs for icons
  const micOn = `<img style = "width:18px;height:18px;" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAACXBIWXMAAAsTAAALEwEAmpwYAAABb0lEQVR4nO1VS0oDQRBtsva3j+AHdS0KCoqpTuLCla66SpOz6FxDcgMJEff5dEVdeABBvIIa0fEAIzWfZJRMMjHBVQqaGd5U1atX012tVAoDW17UjFVtyZUFFms5PltPE5sqOVjqaCYvvgQrNEx2bAItlf9KHiO5Gp/AkptIwPQxAQXkDVpTAjVt0f+2SDN9SdDe/fFshIHFzzTn4OihPOfjltxEArD4HJxQsxnDaskKsBr5Fdq4FWJPgxRUwhFwHmHFW9oAprd+swisWevFohPil4kEOcZ8KPNFJHera5iszB1pV9AyrMaTgz1Z6BbRMpBI4DszcVAJ1pTnZNQw85wMMN6EMc2h/mBpWVt8D5Tg9WHdzCf7SuVRcurkm6UllcZ063S3dwfgq2a6kJ8I1szIDsu3zLb0PGqLPAtts6NGseJdaRUYG8POgWaqH7TNykjJf6rBfdldwPjY2//+e0W+/TlxXzKe0B0wJVAx+wYVT7GGVb/1YAAAAABJRU5ErkJggg==" alt="microphone">`;
  const micOff = `<img style="width:18px;height:18px;" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAACXBIWXMAAAsTAAALEwEAmpwYAAABX0lEQVR4nO1Vy0oDMRQNXfvoXsEH6loUdNGFuOuqyT0ln6PzG+IfyDDiXgU/oiD+glrRSp0mXUQyZoYonWm0xdUELgOXe8+550wejAWsIdGqBmIFDGxoIBkB2yG9QeCKqK8B44fNDaVcmZlAA/FP8CKILmYmUF+WTCRQRK/zUGCqoiZgtUX/a5EierdNptNZ9HJvIefAtNtLWQ4YVE37kBVxvuvlkgoFsTfInjvd91UE567oJM+NhNhRwPOkuyiVcsvrjZyCs1KCMXDsmh+t5DxvLzV771i7nGWxD244bxZDCHFUSpBJBe7clImJokZlsQWPooYGrtz0t9PqWcr5ugJeHMmlkXK5FJzzZgFO1P8A1ljI0t3uYf4GKOBJA6f2JxopF+wO00LsW89zW7KvEAdB4IUSYFMR3Uw7B4roOpVy41fg39QArWx3EfW8h6bndlzrz8AlZGYub0BNwLz1CS6X6eDd8VgNAAAAAElFTkSuQmCC" alt="microphone">`;
  const videoOn = `<img width="18px" height="18px" src="https://img.icons8.com/android/24/40C057/video-call.png" alt="video-call"/>`;
  const videoOff = `<img width="18px" height="18px" src="https://img.icons8.com/android/24/FA5252/video-call.png" alt="video-call"/>`;

  // Add local user
  if (NAME && UID) {
    const micStatus = localUserStatus.micMuted ? micOff : micOn;
    const videoStatus = localUserStatus.videoMuted ? videoOff : videoOn;

    const localDiv = document.createElement("div");
    localDiv.className = "participant-item";
    localDiv.innerHTML = `${NAME} (You) ${micStatus} ${videoStatus}`;
    participantsList.appendChild(localDiv);
  }

  // Add remote users
  Object.values(remoteUsers).forEach((user) => {
    let micStatus = micOn,
      videoStatus = videoOn;
    // Mic status
    if (!user.audioTrack || user.audioTrack.muted) micStatus = micOff;
    // Video status
    if (!user.videoTrack || user.videoTrack.muted) videoStatus = videoOff;

    const userDiv = document.createElement("div");
    userDiv.className = "participant-item";
    userDiv.innerHTML = `${
      user.displayName || `User ${user.uid}`
    } ${micStatus} ${videoStatus}`;
    participantsList.appendChild(userDiv);
  });
}

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
  // If host left, handle it
  if (data.status === "host_left") {
    window.open("/dashboard", "_self");
    return data;
  }

  return data;
};

window.addEventListener("beforeunload", deleteMember);

joinAndDisplayLocalStream();

// Set up event listeners after joining the stream
document
  .getElementById("leave-btn")
  .addEventListener("click", leaveAndRemoveLocalStream);
document.getElementById("camera-btn").addEventListener("click", toggleCamera);
document.getElementById("mic-btn").addEventListener("click", toggleMic);

// Set up dubbing button event listener
setTimeout(() => {
  const dubbingBtn = document.getElementById("dubbing-btn");
  if (dubbingBtn && !dubbingBtn.hasEventListener) {
    console.log("Setting up dubbing button event listener");
    dubbingBtn.addEventListener("click", toggleDubbing);
    dubbingBtn.hasEventListener = true;
  } else if (!dubbingBtn) {
    console.error("Dubbing button not found");
  }
}, 1000); // Wait 1 second for everything to load

// Screen sharing functionality
let toggleScreenShare = async () => {
  const screenShareBtn = document.getElementById("screen-share-btn");

  if (!isScreenSharing) {
    try {
      screenShareBtn.disabled = true; // Prevent double-clicking
      screenTrack = await AgoraRTC.createScreenVideoTrack({
        encoderConfig: {
          width: { max: 1920 },
          height: { max: 1080 },
          frameRate: 30,
          bitrateMax: 1000,
        },
      });

      // Handle screen share stop from browser UI
      screenTrack.on("track-ended", () => {
        stopScreenShare();
      });

      await client.unpublish([localTracks[1]]); // Unpublish camera
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
      showError(
        error.message === "Permission denied"
          ? "Screen share permission denied"
          : "Failed to share screen"
      );
      stopScreenShare();
    } finally {
      screenShareBtn.disabled = false;
    }
  } else {
    await stopScreenShare();
  }
};

// Helper function to stop screen sharing
async function stopScreenShare() {
  const screenShareBtn = document.getElementById("screen-share-btn");
  try {
    if (screenTrack) {
      await client.unpublish([screenTrack]);
      await client.publish([localTracks[1]]); // Republish camera

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

// Captions functionality
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

// Dubbing functionality
let toggleDubbing = () => {
  console.log("=== DUBBING TOGGLE CALLED ===");
  console.log("Current state:", isDubbingEnabled);

  const dubbingBtn = document.getElementById("dubbing-btn");

  if (!dubbingBtn) {
    console.error("Dubbing button not found!");
    return;
  }

  // Toggle the state
  isDubbingEnabled = !isDubbingEnabled;

  console.log("New dubbing state:", isDubbingEnabled);

  if (isDubbingEnabled) {
    // Enable dubbing
    console.log("Enabling dubbing...");

    // Check if we have any audio processors
    if (Object.keys(userAudioProcessors).length === 0) {
      console.log("Setting up local user audio first");
      const setupSuccess = setupLocalUserAudio();

      if (setupSuccess) {
        console.log("Audio setup successful, starting dubbing");
        startDubbingForAllUsers();
        dubbingBtn.classList.add("active");
        showSuccess(
          "Live dubbing enabled - Fast Arabic to English translation active"
        );
      } else {
        console.error("Audio setup failed");
        isDubbingEnabled = false; // Revert the state
        dubbingBtn.classList.remove("active");
        showError(
          "Failed to set up audio processing. Please check microphone permissions and try again."
        );
      }
    } else {
      console.log("Audio processors available, starting dubbing");
      startDubbingForAllUsers();
      dubbingBtn.classList.add("active");
      showSuccess(
        "Live dubbing enabled - Fast Arabic to English translation active"
      );
    }
  } else {
    // Disable dubbing and return to normal audio
    console.log("Disabling dubbing, returning to normal audio...");

    dubbingBtn.classList.remove("active");
    showSuccess("Live dubbing disabled - Normal audio playback");

    // Stop dubbing for all current users and restore normal audio
    Object.keys(userAudioProcessors).forEach((userId) => {
      console.log("Stopping dubbing for user:", userId);
      stopDubbingForUser(userId);
    });
  }
};

// Helper function to start dubbing for all users
function startDubbingForAllUsers() {
  Object.keys(userAudioProcessors).forEach((userId) => {
    console.log("Starting dubbing for user:", userId);
    try {
      startDubbingForUser(userId);
    } catch (error) {
      console.error(`Failed to start dubbing for user ${userId}:`, error);
    }
  });
}

// Make toggleDubbing globally accessible
window.toggleDubbing = toggleDubbing;

if (recognition) {
  recognition.onresult = (event) => {
    const captionsContainer = document.getElementById(`captions-${UID}`);
    if (captionsContainer) {
      const results = Array.from(event.results);
      const transcript = results.map((result) => result[0].transcript).join("");
      captionsContainer.textContent = transcript;
      captionsContainer.classList.toggle("active", isCaptionsEnabled);
    }
  };
}

// Error display helper
const showError = (message) => {
  const errorElement = document.getElementById("error-message");
  if (errorElement) {
    errorElement.textContent = message;
    errorElement.style.display = "block";
    errorElement.style.background = "var(--danger-red)";
    setTimeout(() => {
      errorElement.style.display = "none";
    }, 5000);
  }
};

// Success display helper
const showSuccess = (message) => {
  const errorElement = document.getElementById("error-message");
  if (errorElement) {
    errorElement.textContent = message;
    errorElement.style.display = "block";
    errorElement.style.background = "#34a853";
    setTimeout(() => {
      errorElement.style.display = "none";
    }, 3000);
  }
};

// Event listeners
document
  .getElementById("screen-share-btn")
  .addEventListener("click", toggleScreenShare);
document
  .getElementById("captions-btn")
  .addEventListener("click", toggleCaptions);

// Ensure all event listeners are set up after DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM loaded, setting up event listeners");

  // Set up dubbing button event listener
  const dubbingBtn = document.getElementById("dubbing-btn");
  if (dubbingBtn && !dubbingBtn.hasEventListener) {
    console.log("Dubbing button found, adding event listener");
    dubbingBtn.addEventListener("click", toggleDubbing);
    dubbingBtn.hasEventListener = true;
  } else if (!dubbingBtn) {
    console.error("Dubbing button not found in DOMContentLoaded!");
  }

  // Set up other event listeners if not already set
  const screenShareBtn = document.getElementById("screen-share-btn");
  if (screenShareBtn && !screenShareBtn.hasEventListener) {
    screenShareBtn.addEventListener("click", toggleScreenShare);
    screenShareBtn.hasEventListener = true;
  }

  const captionsBtn = document.getElementById("captions-btn");
  if (captionsBtn && !captionsBtn.hasEventListener) {
    captionsBtn.addEventListener("click", toggleCaptions);
    captionsBtn.hasEventListener = true;
  }
});

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

// Simple audio recording test function
function testAudioRecording(userId) {
  console.log(`Testing audio recording for user ${userId}`);

  if (!userAudioProcessors[userId]) {
    console.error("No audio processor found for testing");
    return;
  }

  const processor = userAudioProcessors[userId];
  const testRecorder = new MediaRecorder(processor.destination.stream, {
    mimeType: "audio/webm;codecs=opus",
  });

  let testChunks = [];

  testRecorder.ondataavailable = (event) => {
    console.log(`Test recording data available: ${event.data.size} bytes`);
    testChunks.push(event.data);
  };

  testRecorder.onstop = () => {
    console.log(`Test recording stopped, total chunks: ${testChunks.length}`);
    const testBlob = new Blob(testChunks, { type: "audio/webm" });
    console.log(`Test audio blob size: ${testBlob.size} bytes`);

    // Create a simple audio element to test playback
    const testAudio = new Audio(URL.createObjectURL(testBlob));
    testAudio.volume = 0.5;
    testAudio
      .play()
      .then(() => {
        console.log("Test audio playback started");
      })
      .catch((err) => {
        console.error("Test audio playback failed:", err);
      });
  };

  testRecorder.start();
  setTimeout(() => {
    testRecorder.stop();
  }, 3000); // Record for 3 seconds

  console.log("Test recording started");
}

// Add test function to window for debugging
window.testAudioRecording = testAudioRecording;

// Test function to send audio to backend without translation
async function testAudioUpload(userId) {
  console.log(`Testing audio upload for user ${userId}`);

  if (!userAudioProcessors[userId]) {
    console.error("No audio processor found for testing");
    return;
  }

  const processor = userAudioProcessors[userId];
  const testRecorder = new MediaRecorder(processor.destination.stream, {
    mimeType: "audio/webm;codecs=opus",
  });

  let testChunks = [];

  testRecorder.ondataavailable = (event) => {
    console.log(`Test recording data available: ${event.data.size} bytes`);
    testChunks.push(event.data);
  };

  testRecorder.onstop = async () => {
    console.log(`Test recording stopped, total chunks: ${testChunks.length}`);
    const testBlob = new Blob(testChunks, { type: "audio/webm" });
    console.log(`Test audio blob size: ${testBlob.size} bytes`);

    // Send to test endpoint
    const formData = new FormData();
    formData.append("audio", testBlob);
    formData.append("uid", userId);

    try {
      const response = await fetch("/meetings/test_audio/", {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        console.log("Test audio upload successful:", data);

        // Try to play the uploaded audio
        if (data.audio_url) {
          const testAudio = new Audio(data.audio_url);
          testAudio.volume = 0.5;
          testAudio
            .play()
            .then(() => {
              console.log("Test audio playback started");
            })
            .catch((err) => {
              console.error("Test audio playback failed:", err);
            });
        }
      } else {
        console.error("Test audio upload failed:", response.status);
      }
    } catch (err) {
      console.error("Test audio upload error:", err);
    }
  };

  testRecorder.start();
  setTimeout(() => {
    testRecorder.stop();
  }, 3000); // Record for 3 seconds

  console.log("Test recording started");
}

// Add test function to window for debugging
window.testAudioUpload = testAudioUpload;

// Test function to monitor continuous recording
function monitorDubbingStatus(userId) {
  console.log(`=== DUBBING STATUS FOR USER ${userId} ===`);
  console.log(`Dubbing enabled: ${isDubbingEnabled}`);
  console.log(`Audio processor exists: ${!!userAudioProcessors[userId]}`);
  console.log(`Active recorder exists: ${!!activeRecorders[userId]}`);

  if (activeRecorders[userId]) {
    const recorder = activeRecorders[userId];
    if (typeof recorder === "object" && recorder.recorder) {
      console.log(`Recorder state: ${recorder.recorder.state}`);
      console.log(`Recorder ready state: ${recorder.recorder.readyState}`);
    } else {
      console.log(`Recorder state: ${recorder.state}`);
    }
  }

  console.log(
    `Dubbing queue length: ${
      dubbingQueue[userId] ? dubbingQueue[userId].length : 0
    }`
  );
  console.log(`Is processing dubbing: ${isProcessingDubbing[userId] || false}`);

  // Check if there are any recent logs
  console.log(
    `Recent activity: Check console for "Recording started", "Data available", "Processing audio blob" messages`
  );
}

// Add monitoring function to window for debugging
window.monitorDubbingStatus = monitorDubbingStatus;


document.addEventListener("DOMContentLoaded", () => {
  // Language select
  const languageSelect = document.getElementById("user-language");
  if (languageSelect) {
    // languageSelect.value = "en"; // default
    languageSelect.addEventListener("change", (e) => {
      // Save user language preference (you can use this in your logic)
      window.userLanguage = e.target.value;
      showSuccess(
        "Language set to " + (e.target.value === "en" ? "English" : "Arabic")
      );
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
      if (typeof showSuccess === "function") {
        showSuccess(
          "Translate captions " + (translateOn ? "enabled" : "disabled")
        );
      }
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

// --- Sentence-end detection for dubbing chunking ---
// Use SpeechRecognition to detect sentence boundaries for local user
// (Globals removed; handled locally in dubbing logic)

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

  return rms > 0.01;
}
