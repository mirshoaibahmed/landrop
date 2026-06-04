const socket = io();

const largeFileMode = Boolean(window.streamSaver);

if (largeFileMode) {
    streamSaver.mitm =
        "https://jimmywarting.github.io/StreamSaver.js/mitm.html?version=2.0.0";
}

let deviceId = localStorage.getItem("landrop_device_id");
let deviceName = localStorage.getItem("landrop_device_name");
let selectedPeer = null;
let roomId = null;

let peerConnection = null;
let dataChannel = null;

let pendingFiles = [];
let currentReceiveFileIndex = 0;
let incomingFilesMeta = [];
let summaryCard = null;
let summaryProgress = 0;
let totalTransferBytes = 0;
let transferredBytes = 0;

let transferQueue = [];
let isProcessingQueue = false;
let activeQueueItem = null;
let queueAcceptResolver = null;

let activeTransferCancelled = false;
let activeTransferId = null;
let activeSenderCard = null;
let activeTransferPaused = false;
let activeTransferPauseResolver = null;
let pauseWaitQueue = [];

let lastTransferStatusMessage = null;
let screenWakeLock = null;

const TAB_HIDDEN_TRANSFER_MESSAGE =
    "Transfer continues if browser keeps this tab active. Do not close the tab.";

const statusText = document.getElementById("status");
const deviceList = document.getElementById("deviceList");
const deviceNameInput = document.getElementById("deviceNameInput");
const progressText = document.getElementById("progressText");
const progressBar = document.getElementById("progressBar");
const speedText = document.getElementById("speedText");
const fileInput = document.getElementById("fileInput");
const folderInput = document.getElementById("folderInput");
const selectedFileCount = document.getElementById("selectedFileCount");
const transferContainer = document.getElementById("transferContainer");
const queueContainer = document.getElementById("queueContainer");
const dropZone = document.getElementById("dropZone");
const zipModeInput = document.getElementById("zipModeInput");

if (queueContainer) {
    queueContainer.addEventListener("click", (event) => {
        const cancelBtn = event.target.closest(".queue-cancel-btn");

        if (cancelBtn) {
            cancelQueueItem(cancelBtn.dataset.id);
            return;
        }

        if (event.target.closest(".queue-clear-btn")) {
            clearCompletedQueueItems();
        }
    });
}

function updateSelectedCount() {
    selectedFileCount.innerText =
        fileInput.files.length + folderInput.files.length;
}

fileInput.addEventListener("change", updateSelectedCount);
folderInput.addEventListener("change", updateSelectedCount);

dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.style.borderColor = "#8b5cf6";
    dropZone.style.background = "rgba(139,92,246,0.12)";
});

dropZone.addEventListener("dragleave", () => {
    dropZone.style.borderColor = "";
    dropZone.style.background = "";
});

dropZone.addEventListener("drop", (e) => {
    e.preventDefault();

    dropZone.style.borderColor = "";
    dropZone.style.background = "";

    const dataTransfer = new DataTransfer();

    for (let i = 0; i < e.dataTransfer.files.length; i++) {
        dataTransfer.items.add(e.dataTransfer.files[i]);
    }

    fileInput.files = dataTransfer.files;
    updateSelectedCount();
});

function getDefaultDeviceName() {
    const ua = navigator.userAgent;

    if (/iPhone/i.test(ua)) return "iPhone";
    if (/iPad/i.test(ua)) return "iPad";
    if (/Android/i.test(ua)) return "Android";
    if (/Mac/i.test(ua)) return "Mac";
    if (/Windows/i.test(ua)) return "Windows-PC";

    return "LANDrop Device";
}

function getDeviceClass(name) {
    const lower = name.toLowerCase();

    if (lower.includes("iphone")) return "iphone";
    if (lower.includes("android")) return "android";
    if (lower.includes("windows")) return "windows";
    if (lower.includes("mac")) return "mac";

    return "windows";
}

function getDeviceIcon(name) {
    const lower = name.toLowerCase();

    if (lower.includes("iphone")) return "📱";
    if (lower.includes("android")) return "🤖";
    if (lower.includes("mac")) return "💻";
    if (lower.includes("windows")) return "🖥️";

    return "📡";
}

if (!deviceName) {
    deviceName = getDefaultDeviceName();
    localStorage.setItem("landrop_device_name", deviceName);
}

deviceNameInput.value = deviceName;

const rtcConfig = {
    iceServers: []
};

function generateRoomId() {
    return "room-" + Date.now() + "-" + Math.random().toString(36).substring(2, 12);
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + " KB";
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + " MB";
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

function getTrustedDevices() {
    try {
        const raw = localStorage.getItem("landrop_trusted_devices");

        if (!raw) return [];

        const parsed = JSON.parse(raw);

        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function isTrustedDevice(deviceId) {
    return getTrustedDevices().includes(deviceId);
}

function trustDevice(deviceId) {
    const trusted = getTrustedDevices();

    if (!trusted.includes(deviceId)) {
        trusted.push(deviceId);
        localStorage.setItem(
            "landrop_trusted_devices",
            JSON.stringify(trusted)
        );
    }
}

function untrustDevice(deviceId) {
    const trusted = getTrustedDevices().filter(
        id => id !== deviceId
    );

    localStorage.setItem(
        "landrop_trusted_devices",
        JSON.stringify(trusted)
    );
}

function showModal({
    title,
    message,
    details = null,
    confirmText = "Confirm",
    cancelText = "Cancel"
}) {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay";

        const card = document.createElement("div");
        card.className = "modal-card";
        card.setAttribute("role", "dialog");
        card.setAttribute("aria-modal", "true");
        card.setAttribute("aria-labelledby", "landrop-modal-title");

        const titleEl = document.createElement("h2");
        titleEl.className = "modal-title";
        titleEl.id = "landrop-modal-title";
        titleEl.textContent = title;

        const messageEl = document.createElement("p");
        messageEl.className = "modal-message";
        messageEl.textContent = message;

        card.appendChild(titleEl);
        card.appendChild(messageEl);

        if (details) {
            const detailsEl = document.createElement("pre");
            detailsEl.className = "modal-details";
            detailsEl.textContent = details;
            card.appendChild(detailsEl);
        }

        const actions = document.createElement("div");
        actions.className = "modal-actions";

        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "modal-secondary";
        cancelBtn.textContent = cancelText;

        const confirmBtn = document.createElement("button");
        confirmBtn.type = "button";
        confirmBtn.className = "modal-primary";
        confirmBtn.textContent = confirmText;

        actions.appendChild(cancelBtn);
        actions.appendChild(confirmBtn);
        card.appendChild(actions);
        overlay.appendChild(card);

        let settled = false;

        const finish = (result) => {
            if (settled) return;

            settled = true;
            document.removeEventListener("keydown", onKeyDown);
            overlay.classList.remove("modal-visible");

            const removeOverlay = () => {
                overlay.remove();
            };

            overlay.addEventListener("transitionend", removeOverlay, { once: true });
            setTimeout(removeOverlay, 350);
            resolve(result);
        };

        const onKeyDown = (event) => {
            if (event.key === "Escape") {
                finish(false);
            }
        };

        confirmBtn.addEventListener("click", () => finish(true));
        cancelBtn.addEventListener("click", () => finish(false));

        overlay.addEventListener("click", (event) => {
            if (event.target === overlay) {
                finish(false);
            }
        });

        document.body.appendChild(overlay);
        document.addEventListener("keydown", onKeyDown);

        requestAnimationFrame(() => {
            overlay.classList.add("modal-visible");
        });

        confirmBtn.focus();
    });
}

async function calculateSHA256FromArrayBuffer(arrayBuffer) {
    const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));

    return hashArray
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
}

async function calculateSHA256FromFile(file) {
    const arrayBuffer = await file.arrayBuffer();

    return calculateSHA256FromArrayBuffer(arrayBuffer);
}

function updateProgress(percent, speedMbps) {
    progressBar.value = percent;
    progressText.innerText = percent.toFixed(2) + "%";
    speedText.innerText = speedMbps.toFixed(2) + " MB/s";
}

function createTransferCard(fileName, direction) {
    const card = document.createElement("div");
    card.className = "transfer-card";

    card.innerHTML = `
        <h4>${direction}: ${fileName}</h4>
        <progress value="0" max="100"></progress>
        <p class="percent">0%</p>
        <p class="speed">0 MB/s</p>
    `;

    transferContainer.appendChild(card);

    return card;
}

function createTransferSummary(folderName, fileCount, totalSize) {

    if (summaryCard) {
        summaryCard.remove();
    }

    summaryCard = document.createElement("div");

    summaryCard.className =
        "transfer-summary-card";

    summaryCard.innerHTML = `
        <h3>📁 ${folderName}</h3>

        <div class="summary-line"></div>

        <p>Files: ${fileCount}</p>

        <p>Total Size: ${formatBytes(totalSize)}</p>

        <progress
            id="summaryProgress"
            value="0"
            max="100">
        </progress>

        <div class="summary-stats">
            <span id="summaryPercent">
                0%
            </span>

            <span id="summarySpeed">
                0 MB/s
            </span>
        </div>

        <div class="transfer-control-row">
            <button
                type="button"
                class="summary-pause-btn transfer-pause-btn">
                Pause
            </button>

            <button
                type="button"
                class="summary-cancel-btn transfer-cancel-btn">
                Cancel
            </button>
        </div>
    `;

    transferContainer.prepend(summaryCard);

    const summaryCancelBtn = summaryCard.querySelector(".summary-cancel-btn");

    if (summaryCancelBtn) {
        summaryCancelBtn.addEventListener("click", () => {
            cancelActiveTransfer("user_cancelled");
        });
    }

    const summaryPauseBtn = summaryCard.querySelector(".summary-pause-btn");

    if (summaryPauseBtn) {
        summaryPauseBtn.addEventListener("click", toggleActiveTransferPause);
    }
}

function updateTransferCard(card, percent, speedMbps) {
    if (!card) return;

    card.querySelector("progress").value = percent;
    card.querySelector(".percent").innerText = percent.toFixed(2) + "%";
    card.querySelector(".speed").innerText = speedMbps.toFixed(2) + " MB/s";
}

function setTransferCardSpeedText(card, text) {
    if (!card) return;

    card.querySelector(".speed").innerText = text;
}

function markTransferCardComplete(card) {
    if (!card) return;

    card.querySelector("progress").value = 100;
    card.querySelector(".percent").innerText = "100%";
    card.querySelector(".speed").innerText = "Completed ✓";
}

function generateTransferId() {
    return "transfer-" + Date.now() + "-" + Math.random().toString(36).substring(2, 10);
}

function isActiveTransferRunning() {
    return Boolean(activeTransferId) && !activeTransferCancelled;
}

async function acquireTransferWakeLock() {
    if (!("wakeLock" in navigator)) {
        return;
    }

    try {
        if (screenWakeLock) {
            return;
        }

        screenWakeLock = await navigator.wakeLock.request("screen");

        screenWakeLock.addEventListener("release", () => {
            screenWakeLock = null;

            if (isActiveTransferRunning() && !document.hidden) {
                acquireTransferWakeLock();
            }
        });
    } catch (error) {
        screenWakeLock = null;
    }
}

async function releaseTransferWakeLock() {
    if (!screenWakeLock) {
        return;
    }

    try {
        await screenWakeLock.release();
    } catch (error) {
        // Wake Lock may already be released (common on iOS Safari).
    }

    screenWakeLock = null;
}

function releaseTransferSafety() {
    releaseTransferWakeLock();
    lastTransferStatusMessage = null;
}

function rememberTransferStatus(message) {
    if (!isActiveTransferRunning()) {
        return;
    }

    if (message && message !== TAB_HIDDEN_TRANSFER_MESSAGE) {
        lastTransferStatusMessage = message;
    }
}

function setTransferStatus(message) {
    statusText.innerText = message;
    rememberTransferStatus(message);
}

function beginActiveTransfer(transferId) {
    activeTransferId = transferId;
    activeTransferCancelled = false;
    activeTransferPaused = false;
    lastTransferStatusMessage = null;
    resumePauseWaiters();
    acquireTransferWakeLock();
}

function resumePauseWaiters() {
    pauseWaitQueue.forEach(resolve => resolve());
    pauseWaitQueue = [];
    activeTransferPauseResolver = null;
}

async function waitIfPaused() {
    while (activeTransferPaused && !activeTransferCancelled) {
        await new Promise((resolve) => {
            pauseWaitQueue.push(resolve);
            activeTransferPauseResolver = resolve;
        });
    }
}

function sendTransferPaused(reason) {
    if (!dataChannel || dataChannel.readyState !== "open") {
        return;
    }

    dataChannel.send(JSON.stringify({
        type: "transfer_paused",
        transferId: activeTransferId,
        reason
    }));
}

function sendTransferResumed() {
    if (!dataChannel || dataChannel.readyState !== "open") {
        return;
    }

    dataChannel.send(JSON.stringify({
        type: "transfer_resumed",
        transferId: activeTransferId
    }));
}

function updatePauseButtonLabels() {
    document.querySelectorAll(".transfer-pause-btn").forEach(button => {
        button.textContent = activeTransferPaused ? "Resume" : "Pause";
    });
}

function markCardPaused(card) {
    if (!card) return;

    card.classList.add("transfer-paused");
    setTransferCardSpeedText(card, "Paused");

    const pauseBtn = card.querySelector(".transfer-pause-btn");

    if (pauseBtn) {
        pauseBtn.textContent = "Resume";
    }
}

function markSummaryPaused() {
    if (!summaryCard) return;

    summaryCard.classList.add("transfer-paused");

    const summarySpeed = summaryCard.querySelector("#summarySpeed");

    if (summarySpeed) {
        summarySpeed.innerText = "Paused";
    }

    const pauseBtn = summaryCard.querySelector(".transfer-pause-btn");

    if (pauseBtn) {
        pauseBtn.textContent = "Resume";
    }
}

function markCardResumed(card) {
    if (!card) return;

    card.classList.remove("transfer-paused");

    const pauseBtn = card.querySelector(".transfer-pause-btn");

    if (pauseBtn) {
        pauseBtn.textContent = "Pause";
    }
}

function markSummaryResumed() {
    if (!summaryCard) return;

    summaryCard.classList.remove("transfer-paused");

    const pauseBtn = summaryCard.querySelector(".transfer-pause-btn");

    if (pauseBtn) {
        pauseBtn.textContent = "Pause";
    }
}

function pauseActiveTransfer(reason) {
    if (
        activeTransferPaused ||
        activeTransferCancelled ||
        !activeTransferId
    ) {
        return;
    }

    activeTransferPaused = true;

    sendTransferPaused(reason);

    markCardPaused(currentReceiveCard);
    markCardPaused(activeSenderCard);
    markSummaryPaused();
    updatePauseButtonLabels();

    setTransferStatus("Transfer paused");
}

function resumeActiveTransfer() {
    if (!activeTransferPaused || activeTransferCancelled) {
        return;
    }

    activeTransferPaused = false;

    sendTransferResumed();
    resumePauseWaiters();

    markCardResumed(currentReceiveCard);
    markCardResumed(activeSenderCard);
    markSummaryResumed();
    updatePauseButtonLabels();

    setTransferStatus("Transfer resumed");
}

function toggleActiveTransferPause() {
    if (activeTransferPaused) {
        resumeActiveTransfer();
    } else {
        pauseActiveTransfer("user_paused");
    }
}

function handlePeerTransferPaused(message) {
    if (
        message.transferId &&
        activeTransferId &&
        message.transferId !== activeTransferId
    ) {
        return;
    }

    activeTransferPaused = true;

    markCardPaused(currentReceiveCard);
    markCardPaused(activeSenderCard);
    markSummaryPaused();
    updatePauseButtonLabels();

    setTransferStatus("Transfer paused by peer");
}

function handlePeerTransferResumed(message) {
    if (
        message.transferId &&
        activeTransferId &&
        message.transferId !== activeTransferId
    ) {
        return;
    }

    activeTransferPaused = false;
    resumePauseWaiters();

    markCardResumed(currentReceiveCard);
    markCardResumed(activeSenderCard);
    markSummaryResumed();
    updatePauseButtonLabels();

    setTransferStatus("Transfer resumed by peer");
}

function addPauseResumeButtonToCard(card) {
    if (!card || card.querySelector(".transfer-pause-btn")) {
        return;
    }

    const pauseBtn = document.createElement("button");

    pauseBtn.type = "button";
    pauseBtn.className = "transfer-pause-btn";
    pauseBtn.textContent = "Pause";
    pauseBtn.addEventListener("click", toggleActiveTransferPause);

    const cancelBtn = card.querySelector(".transfer-cancel-btn");

    if (cancelBtn) {
        card.insertBefore(pauseBtn, cancelBtn);
    } else {
        card.appendChild(pauseBtn);
    }
}

function addCancelButtonToCard(card, onCancel) {
    if (!card || card.querySelector(".transfer-cancel-btn")) {
        return;
    }

    const cancelBtn = document.createElement("button");

    cancelBtn.type = "button";
    cancelBtn.className = "transfer-cancel-btn";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", onCancel);
    card.appendChild(cancelBtn);
}

function markCardCancelled(card) {
    if (!card) return;

    card.classList.add("transfer-cancelled");
    setTransferCardSpeedText(card, "Cancelled");

    const cancelBtn = card.querySelector(".transfer-cancel-btn");
    const pauseBtn = card.querySelector(".transfer-pause-btn");

    if (cancelBtn) {
        cancelBtn.remove();
    }

    if (pauseBtn) {
        pauseBtn.remove();
    }
}

function markSummaryCancelled() {
    if (!summaryCard) return;

    summaryCard.classList.add("transfer-cancelled");

    const summarySpeed = summaryCard.querySelector("#summarySpeed");

    if (summarySpeed) {
        summarySpeed.innerText = "Cancelled";
    }

    const cancelBtn = summaryCard.querySelector(".summary-cancel-btn");
    const pauseBtn = summaryCard.querySelector(".transfer-pause-btn");

    if (cancelBtn) {
        cancelBtn.remove();
    }

    if (pauseBtn) {
        pauseBtn.remove();
    }
}

function sendTransferCancelled(reason) {
    if (!dataChannel || dataChannel.readyState !== "open") {
        return;
    }

    dataChannel.send(JSON.stringify({
        type: "transfer_cancelled",
        transferId: activeTransferId,
        reason
    }));
}

async function cleanupCancelledTransfer() {
    await abortReceiveStream();
    receivedBuffers = [];
    pendingChunkMeta = null;
    receiveChunkError = false;
    receivedBytes = 0;
}

async function cancelActiveTransfer(reason) {
    if (activeTransferCancelled) {
        return;
    }

    activeTransferCancelled = true;
    activeTransferPaused = false;
    resumePauseWaiters();

    sendTransferCancelled(reason);

    if (queueAcceptResolver) {
        queueAcceptResolver(false);
        queueAcceptResolver = null;
    }

    markCardCancelled(currentReceiveCard);
    markCardCancelled(activeSenderCard);
    markSummaryCancelled();

    setTransferStatus("Transfer cancelled");

    await cleanupCancelledTransfer();
    releaseTransferSafety();
}

async function handlePeerTransferCancelled(message) {
    if (
        message.transferId &&
        activeTransferId &&
        message.transferId !== activeTransferId
    ) {
        return;
    }

    activeTransferCancelled = true;
    activeTransferPaused = false;
    resumePauseWaiters();

    if (queueAcceptResolver) {
        queueAcceptResolver(false);
        queueAcceptResolver = null;
    }

    await cleanupCancelledTransfer();

    markCardCancelled(currentReceiveCard);
    markCardCancelled(activeSenderCard);
    markSummaryCancelled();

    setTransferStatus("Transfer cancelled by peer");
    releaseTransferSafety();
}

function generateQueueId() {
    return "queue-" + Date.now() + "-" + Math.random().toString(36).substring(2, 10);
}

function buildQueueLabel(files, zipMode) {
    if (zipMode) {
        return "Documents.zip";
    }

    if (files.length === 1) {
        const file = files[0];

        return file.webkitRelativePath || file.name;
    }

    const firstPath = files[0].webkitRelativePath || files[0].name;
    const folderName = firstPath.includes("/")
        ? firstPath.split("/")[0]
        : firstPath;

    return `${folderName} (${files.length} files)`;
}

function setQueueItemState(item, state) {
    if (!item) return;

    item.state = state;
    renderQueueCard();
}

function getQueueCounts() {
    const queued = transferQueue.filter(item => item.state === "Queued").length;
    const sending = transferQueue.filter(item =>
        item.state === "Preparing" ||
        item.state === "Sending" ||
        item.state === "Verifying"
    ).length;

    return { queued, sending };
}

function renderQueueCard() {
    if (!queueContainer) return;

    if (transferQueue.length === 0) {
        queueContainer.innerHTML = "";
        return;
    }

    const { queued, sending } = getQueueCounts();
    const hasCompleted = transferQueue.some(item => item.state === "Completed");

    queueContainer.innerHTML = `
        <div class="queue-card">
            <div class="queue-header">
                <h3>Queue</h3>
                <div class="queue-counters">
                    <span>Queued: ${queued}</span>
                    <span>Sending: ${sending}</span>
                </div>
            </div>

            <ol class="queue-list">
                ${transferQueue.map((item, index) => `
                    <li class="queue-item queue-state-${item.state.toLowerCase()}">
                        <div class="queue-item-main">
                            <span class="queue-index">${index + 1}.</span>
                            <span class="queue-label">${item.label}</span>
                            <span class="queue-state">${item.state}</span>
                        </div>
                        ${item.state === "Queued"
                            ? `<button
                                type="button"
                                class="queue-cancel-btn"
                                data-id="${item.id}">
                                Cancel
                            </button>`
                            : ""}
                    </li>
                `).join("")}
            </ol>

            ${hasCompleted
                ? `<button type="button" class="queue-clear-btn">
                    Clear Completed
                </button>`
                : ""}
        </div>
    `;
}

function cancelQueueItem(queueId) {
    const item = transferQueue.find(entry => entry.id === queueId);

    if (!item || item.state !== "Queued") {
        return;
    }

    transferQueue = transferQueue.filter(entry => entry.id !== queueId);
    renderQueueCard();

    statusText.innerText = `Removed "${item.label}" from queue`;
}

function clearCompletedQueueItems() {
    transferQueue = transferQueue.filter(item => item.state !== "Completed");
    renderQueueCard();
}

function waitForQueueAccept() {
    return new Promise((resolve) => {
        queueAcceptResolver = resolve;
    });
}

async function prepareQueueFiles(item) {
    let files = item.files.filter(file => file.size > 0);

    if (item.zipMode) {
        statusText.innerText = "Building ZIP...";

        const zip = new JSZip();

        for (const file of files) {
            if (activeTransferCancelled) {
                return files;
            }

            const relativePath = file.webkitRelativePath || file.name;

            zip.file(relativePath, file);
        }

        if (activeTransferCancelled) {
            return files;
        }

        const blob = await zip.generateAsync({
            type: "blob"
        });

        files = [
            new File(
                [blob],
                "Documents.zip",
                { type: "application/zip" }
            )
        ];
    }

    item.preparedFiles = files;

    return files;
}

async function sendPendingFilesForQueue(item) {
    const files = item.preparedFiles || [];

    if (files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
        if (activeTransferCancelled) {
            break;
        }

        await waitIfPaused();

        if (activeTransferCancelled) {
            break;
        }

        const sent = await sendSingleFile(files[i], i + 1, files.length);

        if (!sent || activeTransferCancelled) {
            break;
        }
    }

    if (activeTransferCancelled) {
        return;
    }

    setQueueItemState(item, "Verifying");

    dataChannel.send(JSON.stringify({
        type: "all_complete"
    }));
}

async function runQueueTransfer(item) {
    activeQueueItem = item;
    beginActiveTransfer(item.id);
    setQueueItemState(item, "Preparing");

    const files = await prepareQueueFiles(item);

    if (activeTransferCancelled) {
        return;
    }

    pendingFiles = files;

    const fileMetaList = files.map(file => ({
        name: file.name,
        size: file.size,
        relativePath: file.webkitRelativePath || file.name
    }));

    const totalSize = files.reduce((sum, file) => sum + file.size, 0);

    dataChannel.send(JSON.stringify({
        type: "files_request",
        files: fileMetaList,
        totalSize,
        transferId: activeTransferId
    }));

    statusText.innerText = "Waiting for receiver to accept files...";

    const accepted = await waitForQueueAccept();

    if (activeTransferCancelled) {
        return;
    }

    if (!accepted) {
        throw new Error("Transfer rejected");
    }

    await waitIfPaused();

    if (activeTransferCancelled) {
        return;
    }

    setQueueItemState(item, "Sending");
    statusText.innerText = "Receiver accepted. Starting transfer...";

    await sendPendingFilesForQueue(item);

    if (activeTransferCancelled) {
        setQueueItemState(item, "Failed");
        statusText.innerText = "Transfer cancelled";

        return;
    }

    setQueueItemState(item, "Completed");

    const remaining = transferQueue.filter(entry => entry.state === "Queued").length;

    if (remaining > 0) {
        statusText.innerText = `Transfer complete. ${remaining} more in queue...`;
    } else {
        statusText.innerText = "All queued transfers sent ✓";
    }
}

async function processQueue() {
    if (isProcessingQueue || activeTransferPaused) return;

    const nextItem = transferQueue.find(item => item.state === "Queued");

    if (!nextItem) return;

    isProcessingQueue = true;

    try {
        await runQueueTransfer(nextItem);
    } catch (error) {
        console.error("Queue transfer error:", error);

        if (activeTransferCancelled) {
            setQueueItemState(nextItem, "Failed");
            statusText.innerText = "Transfer cancelled";
        } else {
            setQueueItemState(nextItem, "Failed");
            statusText.innerText = `Transfer failed: ${nextItem.label}`;
        }
    }

    isProcessingQueue = false;
    activeQueueItem = null;
    activeSenderCard = null;
    pendingFiles = [];
    queueAcceptResolver = null;
    activeTransferCancelled = false;
    activeTransferId = null;
    activeTransferPaused = false;
    resumePauseWaiters();
    releaseTransferSafety();
    renderQueueCard();
    processQueue();
}

function joinTransferRoom(roomId) {
    return new Promise((resolve) => {
        socket.emit("join-transfer-room", { roomId }, () => resolve());
    });
}

function resetConnection() {
    if (dataChannel) {
        dataChannel.close();
        dataChannel = null;
    }

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    roomId = null;
}

function goOnline() {
    deviceName = deviceNameInput.value.trim();

    if (!deviceName) {
        alert("Enter device name");
        return;
    }

    localStorage.setItem("landrop_device_name", deviceName);

    socket.emit("go-online", {
        deviceId,
        deviceName
    });

    statusText.innerHTML = "🟢 Online • Searching for nearby devices";
}

window.goOnline = goOnline;

socket.on("device-id", (data) => {
    deviceId = data.deviceId;
    localStorage.setItem("landrop_device_id", deviceId);
});

socket.on("devices-updated", (devices) => {
    deviceList.innerHTML = "";

    devices
        .filter(device => device.deviceId !== deviceId)
        .forEach(device => {
            const li = document.createElement("li");
            const deviceClass = getDeviceClass(device.deviceName);
            const trusted = isTrustedDevice(device.deviceId);
            const statusLabel = trusted ? "Trusted ✓" : "Online now";
            const connectLabel = trusted ? "Quick Connect" : "Connect";

            li.className = "device-card";

            li.innerHTML = `
                <div class="device-left">
                    <div class="device-icon ${deviceClass}">
                        ${getDeviceIcon(device.deviceName)}
                    </div>

                    <div>
                        <div class="device-name">
                            ${device.deviceName}
                        </div>

                        <div class="device-status">
                            <span class="online-dot"></span>
                            ${statusLabel}
                        </div>
                    </div>
                </div>

                <button class="connect-btn">
                    ${connectLabel}
                </button>
            `;

            li.querySelector(".connect-btn").onclick = () => {
                requestConnect(device);
            };

            deviceList.appendChild(li);
        });
});

function requestConnect(peer) {
    resetConnection();

    selectedPeer = peer;

    socket.emit("request-connect", {
        targetDeviceId: peer.deviceId,
        senderDevice: {
            deviceId,
            deviceName,
            trusted: isTrustedDevice(peer.deviceId)
        }
    });

    statusText.innerText = "Connection request sent to " + peer.deviceName;
}

async function acceptIncomingConnection(senderDevice) {
    selectedPeer = senderDevice;
    roomId = generateRoomId();

    await joinTransferRoom(roomId);
    createPeerConnection();

    socket.emit("accept-connect", {
        requesterSocketId: senderDevice.socketId,
        roomId
    });

    statusText.innerText = "Accepted. Waiting for connection...";
}

socket.on("incoming-connect", async (senderDevice) => {
    resetConnection();

    const autoAccept =
        senderDevice.trusted === true &&
        isTrustedDevice(senderDevice.deviceId);

    let accepted = autoAccept;

    if (!autoAccept) {
        accepted = await showModal({
            title: "Connection Request",
            message: `${senderDevice.deviceName} wants to connect.`,
            confirmText: "Accept",
            cancelText: "Decline"
        });
    }

    if (!accepted) {
        statusText.innerText = "Connection request rejected.";
        return;
    }

    await acceptIncomingConnection(senderDevice);

    if (!autoAccept) {
        const trust = await showModal({
            title: "Trust Device",
            message: "Trust this device for faster connections next time?",
            confirmText: "Trust",
            cancelText: "Not now"
        });

        if (trust) {
            trustDevice(senderDevice.deviceId);
        }
    }
});

socket.on("connect-accepted", async (data) => {
    resetConnection();

    roomId = data.roomId;

    await joinTransferRoom(roomId);
    createPeerConnection();

    dataChannel = peerConnection.createDataChannel("landrop");
    setupDataChannel();

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.emit("signal", {
        roomId,
        signal: offer
    });

    statusText.innerText = "Connecting...";
});

socket.on("signal", async (signal) => {
    if (!peerConnection) {
        createPeerConnection();
    }

    if (signal.type === "offer") {
        await peerConnection.setRemoteDescription(signal);

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        socket.emit("signal", {
            roomId,
            signal: answer
        });
    } else if (signal.type === "answer") {
        await peerConnection.setRemoteDescription(signal);
    } else if (signal.candidate) {
        try {
            await peerConnection.addIceCandidate(signal);
        } catch (error) {
            console.error("ICE candidate error:", error);
        }
    }
});

function createPeerConnection() {
    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit("signal", {
                roomId,
                signal: event.candidate
            });
        }
    };

    peerConnection.onconnectionstatechange = () => {
        if (!peerConnection) return;

        if (peerConnection.connectionState === "connected") {
            statusText.innerText = "CONNECTED ✓ Ready to send.";
        } else {
            statusText.innerText = "Connection: " + peerConnection.connectionState;
        }
    };

    peerConnection.ondatachannel = (event) => {
        dataChannel = event.channel;
        setupDataChannel();
    };
}

function setupDataChannel() {
    dataChannel.binaryType = "arraybuffer";

    dataChannel.onopen = () => {
        statusText.innerText = "CONNECTED ✓ Ready to send.";
    };

    dataChannel.onmessage = (event) => {
        receiveData(event.data).catch(error => {
            console.error("Receive data error:", error);
        });
    };

    dataChannel.onclose = () => {
        statusText.innerText = "Data channel closed.";
    };

    dataChannel.onerror = (error) => {
        console.error("Data channel error:", error);
        statusText.innerText = "Data channel error.";
    };
}

async function requestFileSend() {
    const selectedFiles = [
        ...Array.from(fileInput.files),
        ...Array.from(folderInput.files)
    ];

    if (selectedFiles.length === 0) {
        alert("Select at least one file or folder");
        return;
    }

    if (!dataChannel || dataChannel.readyState !== "open") {
        alert("Not connected to another device");
        return;
    }

    const files = selectedFiles.filter(file => file.size > 0);
    const zipMode = zipModeInput.checked;

    if (files.length === 0) {
        alert("Selected files are empty");
        return;
    }

    const label = buildQueueLabel(files, zipMode);

    transferQueue.push({
        id: generateQueueId(),
        files,
        zipMode,
        timestamp: Date.now(),
        state: "Queued",
        label
    });

    fileInput.value = "";
    folderInput.value = "";
    updateSelectedCount();
    renderQueueCard();
    processQueue();

    statusText.innerText = `Added "${label}" to queue`;
}

window.requestFileSend = requestFileSend;

window.addEventListener("load", () => {
    goOnline();
});

window.addEventListener("beforeunload", (event) => {
    if (!isActiveTransferRunning()) {
        return;
    }

    event.preventDefault();
    event.returnValue = "";
});

document.addEventListener("visibilitychange", () => {
    if (!isActiveTransferRunning()) {
        return;
    }

    if (document.hidden) {
        rememberTransferStatus(statusText.innerText);
        statusText.innerText = TAB_HIDDEN_TRANSFER_MESSAGE;

        return;
    }

    if (lastTransferStatusMessage) {
        statusText.innerText = lastTransferStatusMessage;
    }

    acquireTransferWakeLock();
});

async function sendSingleFile(file, fileNumber, totalFiles) {
    if (activeTransferCancelled) {
        return false;
    }

    const relativePath = file.webkitRelativePath || file.name;

    await waitIfPaused();

    if (activeTransferCancelled) {
        return false;
    }

    statusText.innerText = "Preparing verification hash...";

    const sha256 = await calculateSHA256FromFile(file);

    if (activeTransferCancelled) {
        return false;
    }

    await waitIfPaused();

    if (activeTransferCancelled) {
        return false;
    }

    dataChannel.send(JSON.stringify({
        type: "metadata",
        name: file.name,
        relativePath,
        size: file.size,
        fileNumber,
        totalFiles,
        sha256
    }));

    const chunkSize = 16 * 1024;
    let offset = 0;
    let lastTime = Date.now();
    let lastBytes = 0;

    updateProgress(0, 0);
    statusText.innerText = `Sending ${fileNumber}/${totalFiles}: ${relativePath}`;

    const card = createTransferCard(relativePath, "Sending");

    activeSenderCard = card;

    addCancelButtonToCard(card, () => {
        cancelActiveTransfer("user_cancelled");
    });

    addPauseResumeButtonToCard(card);

    let chunkIndex = 0;

    while (offset < file.size) {
        if (activeTransferCancelled) {
            markCardCancelled(card);
            activeSenderCard = null;

            return false;
        }

        await waitIfPaused();

        if (activeTransferCancelled) {
            markCardCancelled(card);
            activeSenderCard = null;

            return false;
        }

        const buffer = await file.slice(offset, offset + chunkSize).arrayBuffer();
        const chunkSha256 = await calculateSHA256FromArrayBuffer(buffer);

        if (activeTransferCancelled) {
            markCardCancelled(card);
            activeSenderCard = null;

            return false;
        }

        dataChannel.send(JSON.stringify({
            type: "chunk_meta",
            fileNumber,
            chunkIndex,
            size: buffer.byteLength,
            sha256: chunkSha256
        }));

        while (dataChannel.bufferedAmount > 1024 * 1024) {
            await waitIfPaused();

            if (activeTransferCancelled) {
                markCardCancelled(card);
                activeSenderCard = null;

                return false;
            }

            await new Promise(resolve => setTimeout(resolve, 20));
        }

        dataChannel.send(buffer);
        offset += buffer.byteLength;
        chunkIndex += 1;

        const now = Date.now();
        const elapsed = (now - lastTime) / 1000;

        if (elapsed >= 0.5 || offset >= file.size) {
            const bytesDiff = offset - lastBytes;
            const speed = elapsed > 0 ? bytesDiff / elapsed / 1024 / 1024 : 0;
            const percent = Math.min((offset / file.size) * 100, 100);

            updateProgress(percent, speed);
            updateTransferCard(card, percent, speed);

            lastTime = now;
            lastBytes = offset;
        }
    }

    if (activeTransferCancelled) {
        markCardCancelled(card);
        activeSenderCard = null;

        return false;
    }

    dataChannel.send(JSON.stringify({
        type: "file_complete",
        name: file.name,
        relativePath
    }));

    markTransferCardComplete(card);
    activeSenderCard = null;

    return true;
}

let receivedBuffers = [];
let receivedFileName = "received-file";
let receivedRelativePath = "received-file";
let receivedFileSize = 0;
let receivedBytes = 0;
let receiveLastTime = 0;
let receiveLastBytes = 0;
let currentReceiveCard = null;
let receivedExpectedSha256 = null;
let fileWriter = null;
let receiveUsingStream = false;
let pendingChunkMeta = null;
let receiveChunkError = false;
let transferChunkHadError = false;

function getStreamSaveFileName(relativePath) {
    const parts = relativePath.split(/[/\\]/);

    return parts[parts.length - 1] || relativePath;
}

async function closeReceiveStream() {
    if (!fileWriter) return;

    try {
        await fileWriter.close();
    } catch (error) {
        console.error("Stream close error:", error);
    }

    fileWriter = null;
    receiveUsingStream = false;
}

async function setupReceiveStream(downloadFileName, fileSize) {
    await closeReceiveStream();
    receivedBuffers = [];

    if (!largeFileMode) {
        return false;
    }

    try {
        const writableStream = streamSaver.createWriteStream(
            downloadFileName,
            { size: fileSize }
        );

        fileWriter = writableStream.getWriter();
        receiveUsingStream = true;

        statusText.innerText =
            "Large-file mode active • Saving directly to disk";

        return true;
    } catch (error) {
        console.error("StreamSaver setup error:", error);
        fileWriter = null;
        receiveUsingStream = false;
        receivedBuffers = [];

        return false;
    }
}

async function abortReceiveStream() {
    if (!fileWriter) return;

    try {
        if (typeof fileWriter.abort === "function") {
            await fileWriter.abort();
        } else {
            await fileWriter.close();
        }
    } catch (error) {
        console.error("Stream abort error:", error);
    }

    fileWriter = null;
    receiveUsingStream = false;
}

async function handleChunkVerificationFailure() {
    receiveChunkError = true;
    transferChunkHadError = true;
    pendingChunkMeta = null;

    setTransferCardSpeedText(currentReceiveCard, "Corrupted ✕");
    statusText.innerText = "Chunk verification failed";

    await abortReceiveStream();
    receivedBuffers = [];
}

async function resetReceiveState() {
    await closeReceiveStream();
    receivedBuffers = [];
    receivedExpectedSha256 = null;
    receivedBytes = 0;
    pendingChunkMeta = null;
    receiveChunkError = false;
}

async function handleReceivedFileComplete() {
    if (activeTransferCancelled) {
        return;
    }

    updateProgress(100, 0);

    if (currentReceiveCard) {
        currentReceiveCard.querySelector("progress").value = 100;
        currentReceiveCard.querySelector(".percent").innerText = "100%";
    }

    if (receiveChunkError) {
        setTransferCardSpeedText(currentReceiveCard, "Corrupted ✕");
        statusText.innerText = "Chunk verification failed";
        await resetReceiveState();

        return;
    }

    if (receiveUsingStream && fileWriter) {
        try {
            await fileWriter.close();
            fileWriter = null;
            receiveUsingStream = false;

            setTransferCardSpeedText(currentReceiveCard, "Verified chunks ✓");
            statusText.innerText =
                "Verified chunks " + receivedRelativePath + " ✓";
        } catch (error) {
            console.error("Stream finalize error:", error);
            setTransferCardSpeedText(currentReceiveCard, "Failed ✕");
            statusText.innerText = "Failed to save " + receivedRelativePath;
        }

        receivedExpectedSha256 = null;
        pendingChunkMeta = null;

        return;
    }

    if (currentReceiveCard) {
        setTransferCardSpeedText(currentReceiveCard, "Verifying...");
    }

    statusText.innerText = "Verifying " + receivedRelativePath + "...";

    const blob = new Blob(receivedBuffers);

    let verified = true;

    if (receivedExpectedSha256) {
        const arrayBuffer = await blob.arrayBuffer();
        const actualHash = await calculateSHA256FromArrayBuffer(arrayBuffer);

        verified =
            actualHash === receivedExpectedSha256.toLowerCase();
    }

    if (verified) {
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = receivedRelativePath;
        a.click();

        URL.revokeObjectURL(url);

        setTransferCardSpeedText(currentReceiveCard, "Verified ✓");
        statusText.innerText = "Verified " + receivedRelativePath + " ✓";
    } else {
        setTransferCardSpeedText(currentReceiveCard, "Corrupted ✕");
        statusText.innerText = "Corrupted " + receivedRelativePath + " ✕";
    }

    receivedBuffers = [];
    receivedExpectedSha256 = null;
}

async function receiveBinaryChunk(data) {
    if (activeTransferCancelled || receiveChunkError) {
        return;
    }

    await waitIfPaused();

    if (activeTransferCancelled || receiveChunkError) {
        return;
    }

    if (!pendingChunkMeta) {
        await handleChunkVerificationFailure();

        throw new Error("Binary chunk received without chunk_meta");
    }

    const chunkMeta = pendingChunkMeta;
    pendingChunkMeta = null;

    if (data.byteLength !== chunkMeta.size) {
        await handleChunkVerificationFailure();

        throw new Error("Chunk size mismatch");
    }

    const chunkHash = await calculateSHA256FromArrayBuffer(data);

    if (chunkHash !== chunkMeta.sha256.toLowerCase()) {
        await handleChunkVerificationFailure();

        throw new Error("Chunk SHA-256 mismatch");
    }

    receivedBytes += data.byteLength;
    transferredBytes += data.byteLength;

    if (receiveUsingStream && fileWriter) {
        await fileWriter.write(new Uint8Array(data));
    } else {
        receivedBuffers.push(data);
    }

    const now = Date.now();
    const elapsed = (now - receiveLastTime) / 1000;

    if (elapsed >= 0.5 || receivedBytes >= receivedFileSize) {
        const bytesDiff = receivedBytes - receiveLastBytes;
        const speed = elapsed > 0 ? bytesDiff / elapsed / 1024 / 1024 : 0;
        const percent = Math.min((receivedBytes / receivedFileSize) * 100, 100);

        const overallPercent =
            (transferredBytes /
                totalTransferBytes) * 100;

        if (summaryCard) {

            summaryCard
                .querySelector(
                    "#summaryProgress"
                )
                .value =
                overallPercent;

            summaryCard
                .querySelector(
                    "#summaryPercent"
                )
                .innerText =
                overallPercent.toFixed(1)
                + "%";

            summaryCard
                .querySelector(
                    "#summarySpeed"
                )
                .innerText =
                speed.toFixed(2)
                + " MB/s";
        }

        updateProgress(percent, speed);
        updateTransferCard(currentReceiveCard, percent, speed);

        receiveLastTime = now;
        receiveLastBytes = receivedBytes;
    }
}

async function receiveData(data) {
    if (typeof data === "string") {
        const message = JSON.parse(data);

        if (message.type === "transfer_cancelled") {
            await handlePeerTransferCancelled(message);

            return;
        }

        if (message.type === "transfer_paused") {
            handlePeerTransferPaused(message);

            return;
        }

        if (message.type === "transfer_resumed") {
            handlePeerTransferResumed(message);

            return;
        }

        if (message.type === "files_request") {
            incomingFilesMeta = message.files;

            const rootFolder =
                message.files[0]
                    ?.relativePath
                    ?.split("/")[0]
                || "Transfer";

            createTransferSummary(
                rootFolder,
                message.files.length,
                message.totalSize
            );

            totalTransferBytes =
                message.totalSize;

            transferredBytes = 0;
            transferChunkHadError = false;

            const fileListText = message.files
                .slice(0, 20)
                .map(file => `• ${file.relativePath || file.name} (${formatBytes(file.size)})`)
                .join("\n");

            const moreText =
                message.files.length > 20
                    ? `\n...and ${message.files.length - 20} more files`
                    : "";

            const details =
                fileListText +
                moreText +
                `\n\nTotal: ${formatBytes(message.totalSize)}`;

            const accepted = await showModal({
                title: "Incoming Transfer",
                message: "A device wants to send files to you.",
                details,
                confirmText: "Accept",
                cancelText: "Reject"
            });

            if (accepted) {
                if (!activeTransferId) {
                    beginActiveTransfer(message.transferId || generateTransferId());
                }

                dataChannel.send(JSON.stringify({
                    type: "files_accept"
                }));

                statusText.innerText = "Files accepted. Waiting for transfer...";
            } else {
                dataChannel.send(JSON.stringify({
                    type: "files_reject"
                }));

                statusText.innerText = "Files rejected.";
            }
        }

        if (message.type === "files_accept") {
            if (queueAcceptResolver) {
                queueAcceptResolver(true);
                queueAcceptResolver = null;
            } else {
                statusText.innerText = "Receiver accepted. Starting transfer...";
            }
        }

        if (message.type === "files_reject") {
            if (queueAcceptResolver) {
                queueAcceptResolver(false);
                queueAcceptResolver = null;
            }

            pendingFiles = [];
            statusText.innerText = "Receiver rejected the files.";
        }

        if (message.type === "chunk_meta") {
            if (activeTransferCancelled) {
                return;
            }

            pendingChunkMeta = message;

            return;
        }

        if (message.type === "metadata") {
            if (activeTransferCancelled) {
                return;
            }
            receivedFileName = message.name;
            receivedRelativePath = message.relativePath || message.name;
            receivedFileSize = message.size;
            receivedExpectedSha256 = message.sha256 || null;
            receivedBytes = 0;
            receiveLastTime = Date.now();
            receiveLastBytes = 0;
            currentReceiveFileIndex = message.fileNumber || 1;
            pendingChunkMeta = null;
            receiveChunkError = false;

            const streamFileName = getStreamSaveFileName(receivedRelativePath);
            const usingStream = await setupReceiveStream(
                streamFileName,
                receivedFileSize
            );

            updateProgress(0, 0);

            if (usingStream) {
                statusText.innerText =
                    "Large-file mode active • Saving directly to disk";
            } else {
                statusText.innerText =
                    `Receiving ${message.fileNumber}/${message.totalFiles}: ${receivedRelativePath}`;
            }

            currentReceiveCard = createTransferCard(receivedRelativePath, "Receiving");

            if (usingStream) {
                currentReceiveCard.classList.add("stream-receive");
            }

            addCancelButtonToCard(currentReceiveCard, () => {
                cancelActiveTransfer("user_cancelled");
            });

            addPauseResumeButtonToCard(currentReceiveCard);
        }

        if (message.type === "file_complete") {
            if (activeTransferCancelled) {
                await resetReceiveState();

                return;
            }

            if (receiveChunkError) {
                pendingChunkMeta = null;
                await resetReceiveState();

                return;
            }

            if (pendingChunkMeta || receivedBytes !== receivedFileSize) {
                await handleChunkVerificationFailure();

                return;
            }

            handleReceivedFileComplete().catch(async (error) => {
                console.error("File receive error:", error);
                setTransferCardSpeedText(currentReceiveCard, "Failed ✕");
                statusText.innerText = "Failed " + receivedRelativePath;
                await resetReceiveState();
            });

            return;
        }

        if (message.type === "all_complete") {
            if (activeTransferCancelled) {
                return;
            }

            if (transferChunkHadError) {
                setTransferStatus("Transfer finished with chunk errors");

                if (summaryCard) {
                    summaryCard.querySelector("#summarySpeed").innerText = "Errors ✕";
                }
            } else {
                setTransferStatus("All files received ✓");

                if (summaryCard) {
                    summaryCard.querySelector("#summaryProgress").value = 100;
                    summaryCard.querySelector("#summaryPercent").innerText = "100%";
                    summaryCard.querySelector("#summarySpeed").innerText = "Completed ✓";
                }
            }

            activeTransferId = null;
            releaseTransferSafety();
        }

        return;
    }

    if (activeTransferCancelled || receiveChunkError) {
        return;
    }

    try {
        await receiveBinaryChunk(data);
    } catch (error) {
        console.error("Chunk receive error:", error);

        if (!receiveChunkError) {
            transferChunkHadError = true;
            setTransferCardSpeedText(currentReceiveCard, "Corrupted ✕");
            statusText.innerText = "Chunk verification failed";
            await resetReceiveState();
        }
    }
}