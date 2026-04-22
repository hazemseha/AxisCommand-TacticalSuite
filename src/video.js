/**
 * video.js — Video upload, storage, playback, and management
 */
import { getVideosByPin, saveVideo, deleteVideo as dbDeleteVideo, generateId } from './db.js';
import { showToast } from './toast.js';
import { refreshFeatureMarker } from './features.js';
import { t } from './i18n.js';

let currentPinId = null;

export function setCurrentPin(pinId) {
  currentPinId = pinId;
}

// ===== RENDER VIDEOS IN MODAL =====

export async function renderVideoList(pinId) {
  const container = document.getElementById('video-list');
  container.innerHTML = '';

  const videos = await getVideosByPin(pinId);

  if (videos.length === 0) {
    return;
  }

  videos.forEach((video) => {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.dataset.videoId = video.id;

    // Create thumbnail video (muted, no controls)
    const thumbVideo = document.createElement('video');
    thumbVideo.muted = true;
    thumbVideo.preload = 'metadata';

    if (video.blob) {
      const url = URL.createObjectURL(video.blob);
      thumbVideo.src = url;
      // Load just enough to show a frame
      thumbVideo.addEventListener('loadeddata', () => {
        thumbVideo.currentTime = 0.5;
      }, { once: true });
    }

    // Play overlay
    const overlay = document.createElement('div');
    overlay.className = 'video-card-overlay';
    overlay.innerHTML = `<div class="video-play-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>`;

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'video-card-delete';
    deleteBtn.innerHTML = '✕';
    deleteBtn.title = 'Delete video';
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await removeVideo(video.id, pinId);
    });

    // Name label
    const nameLabel = document.createElement('div');
    nameLabel.className = 'video-card-name';
    nameLabel.textContent = video.name || t('video');

    card.appendChild(thumbVideo);
    card.appendChild(overlay);
    card.appendChild(deleteBtn);
    card.appendChild(nameLabel);

    // Click to play
    card.addEventListener('click', () => {
      playVideo(video);
    });

    container.appendChild(card);
  });
}

// ===== VIDEO PLAYBACK =====

function playVideo(video) {
  const modal = document.getElementById('video-modal');
  const player = document.getElementById('video-player');
  const title = document.getElementById('video-modal-title');

  title.textContent = video.name || t('video');

  // Revoke any previous source
  if (player.src) {
    URL.revokeObjectURL(player.src);
  }

  if (video.blob) {
    player.src = URL.createObjectURL(video.blob);
  }

  modal.classList.remove('hidden');
  player.play().catch(() => {}); // autoplay may be blocked
}

export function closeVideoPlayer() {
  const modal = document.getElementById('video-modal');
  const player = document.getElementById('video-player');
  player.pause();
  if (player.src) {
    URL.revokeObjectURL(player.src);
    player.src = '';
  }
  modal.classList.add('hidden');
}

// ===== VIDEO UPLOAD =====

export async function handleVideoFiles(files, pinId) {
  if (!pinId) {
    showToast(t('noPin'), 'error');
    return;
  }

  const progressContainer = document.getElementById('upload-progress');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');

  progressContainer.classList.remove('hidden');

  const totalFiles = files.length;
  let uploaded = 0;

  for (const file of files) {
    progressText.textContent = `${t('uploading').replace('...', '')} ${uploaded + 1}/${totalFiles}: ${file.name}`;
    progressFill.style.width = `${(uploaded / totalFiles) * 100}%`;

    try {
      const blob = file; // File is already a Blob

      const videoRecord = {
        id: generateId(),
        pinId: pinId,
        name: file.name,
        type: file.type,
        size: file.size,
        blob: blob,
        createdAt: Date.now()
      };

      await saveVideo(videoRecord);
      uploaded++;
      progressFill.style.width = `${(uploaded / totalFiles) * 100}%`;
    } catch (err) {
      console.error('Failed to save video:', err);
      showToast(`Failed to save ${file.name}`, 'error');
    }
  }

  progressContainer.classList.add('hidden');
  progressFill.style.width = '0%';

  await renderVideoList(pinId);
  await refreshFeatureMarker(pinId);
  showToast(`${uploaded} ${t('videoAdded')}`, 'success');
}

// ===== DELETE VIDEO =====

async function removeVideo(videoId, pinId) {
  await dbDeleteVideo(videoId);
  await renderVideoList(pinId);
  await refreshFeatureMarker(pinId);
  showToast(t('videoRemoved'), 'info');
}

// ===== SETUP UPLOAD LISTENERS =====

export function setupVideoUpload() {
  const uploadArea = document.getElementById('video-upload-area');
  const fileInput = document.getElementById('video-file-input');

  // Click to upload
  uploadArea.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0 && currentPinId) {
      handleVideoFiles(Array.from(e.target.files), currentPinId);
      fileInput.value = ''; // Reset
    }
  });

  // Drag & Drop
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('drag-over');
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('video/'));
    if (files.length > 0 && currentPinId) {
      handleVideoFiles(files, currentPinId);
    } else if (files.length === 0) {
      showToast(t('dropVideoOnly'), 'error');
    }
  });

  // Video modal close
  document.getElementById('video-modal-close').addEventListener('click', closeVideoPlayer);
  document.getElementById('video-modal').querySelector('.modal-backdrop').addEventListener('click', closeVideoPlayer);
}
