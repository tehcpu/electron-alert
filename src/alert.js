// Copyright 2019-21 PJ Engineering and Business Solutions Pty. Ltd. All rights reserved.

const { ipcMain, globalShortcut, app, BrowserWindow } = require("electron");
const tempWrite = require("temp-write");
const cleanStak = require("clean-stack");
const cryptoRandomString = require("crypto-random-string");
const Positioner = require("electron-positioner");
const fs = require("fs");
const exceptionFormatter = require("exception-formatter");
const DismissReason = Object.freeze({
	cancel: "cancel",
	close: "close",
	esc: "esc",
	timer: "timer",
	showing: "showing", // alert with the same singleton id is currently showing
});
const SoundType = Object.freeze({
	sine: "sine",
	square: "square",
	triange: "triange",
	sawtooth: "sawtooth",
});

const isMac = process.platform === "darwin";

const singletonIds = {};

module.exports = class Alert {
	constructor(head, devTools) {
		this.head = head;
		this.devTools = devTools;
		this.uid = cryptoRandomString({ length: 10 });
		this.browserWindow = null;
		this.position = "center";
		this._isVisible = false;
	}

	static get SoundType() {
		return SoundType;
	}

	static get DismissReason() {
		return DismissReason;
	}

	isVisible() {
		return this._isVisible;
	}

	enableButtons() {
		this.execJS(`Swal.enableButtons()`);
	}

	disableButtons() {
		this.execJS(`Swal.disableButtons()`);
	}

	showLoading() {
		this.execJS(`Swal.showLoading()`);
	}

	enableLoading() {
		this.showLoading();
	}

	hideLoading() {
		this.execJS(`Swal.hideLoading()`);
	}

	disableLoading() {
		this.hideLoading();
	}

	isLoading() {
		return this.execJS(`Swal.isLoading()`);
	}

	clickConfirm() {
		this.execJS(`Swal.clickConfirm()`);
	}

	clickCancel() {
		this.execJS(`Swal.clickCancel()`);
	}

	clickDeny() {
		this.execJS(`Swal.clickDeny()`);
	}

	showValidationMessage(validationMessage) {
		this.execJS(`Swal.showValidationMessage('${validationMessage}')`, () => {
			if (this.browserWindow) {
				this.browserWindow.webContents.send(`${this.uid}resizeToFit`, 25);
			}
		});
	}

	resetValidationMessage() {
		this.execJS(`Swal.resetValidationMessage()`, () => {
			if (this.browserWindow) {
				this.browserWindow.webContents.send(`${this.uid}resizeToFit`, 25);
			}
		});
	}

	disableInput() {
		this.execJS(`Swal.disableInput()`);
	}

	enableInput() {
		this.execJS(`Swal.enableInput()`);
	}

	getTimerLeft() {
		return this.execJS(`Swal.getTimerLeft()`);
	}

	stopTimer() {
		return this.execJS(`Swal.stopTimer()`);
	}

	resumeTimer() {
		return this.execJS(`Swal.resumeTimer()`);
	}

	toggleTimer() {
		return this.execJS(`Swal.toggleTimer()`);
	}

	isTimerRunning() {
		//method should be looked into / revisited
		return this.execJS(`Swal.isTimerRunning()`);
	}

	increaseTimer(n) {
		return this.execJS(`Swal.increaseTimer(${n})`);
	}

	isValidParameter(paramName) {
		return this.execJS(`Swal.isValidParameter('${paramName}')`);
	}

	isUpdatableParameter(paramName) {
		return this.execJS(`isUpdatableParameter('${paramName}')`);
	}

	fireFrameless(swalOptions, parent, alwaysOnTop, draggable, sound, size) {
		var bwOptions = {};

		if (swalOptions.hasOwnProperty("bw")) {
			bwOptions = swalOptions.bw;
		}

		bwOptions = Object.assign(bwOptions, {
			frame: false,
			transparent: true,
			thickFrame: false,
			closable: false,
			backgroundColor: "#00000000",
			hasShadow: false,
		});

		swalOptions.backdrop = `rgba(0,0,0,0.0)`;
		swalOptions.allowOutsideClick = false;

		if (size !== undefined) {
			if (size.hasOwnProperty("width")) {
				bwOptions.width = size.width;
			}
			if (size.hasOwnProperty("height")) {
				bwOptions.height = size.height;
			}
		}

		return this.fire(
			swalOptions,
			bwOptions,
			parent,
			alwaysOnTop,
			draggable,
			sound
		);
	}

	fireWithFrame(swalOptions, title, parent, alwaysOnTop, sound, size) {
		var bwOptions = {};

		if (swalOptions.hasOwnProperty("bw")) {
			bwOptions = swalOptions.bw;
		}

		bwOptions = Object.assign(bwOptions, {
			frame: true,
			transparent: false,
			thickFrame: true,
			closable: true,
			title: title ? title : "name" in app ? app.name : app.getName(),
		});

		swalOptions.allowOutsideClick = false;

		if (size !== undefined) {
			if (size.hasOwnProperty("width")) {
				bwOptions.width = size.width;
			}
			if (size.hasOwnProperty("height")) {
				bwOptions.height = size.height;
			}
		}

		swalOptions.customClass = Object.assign(
			swalOptions.customClass ? swalOptions.customClass : {},
			{
				popup: "border-radius-0",
			}
		);

		// Disable animation
		swalOptions.showClass = Object.assign(
			swalOptions.showClass ? swalOptions.showClass : {},
			{
				backdrop: "swal2-noanimation",
				popup: "",
				icon: "",
			}
		);

		swalOptions.hideClass = Object.assign(
			swalOptions.hideClass ? swalOptions.hideClass : {},
			{
				popup: "",
			}
		);

		return this.fire(swalOptions, bwOptions, parent, alwaysOnTop, false, sound);
	}

	static fireToast(swalOptions, sound, size) {
		// Animation: https://github.com/electron/electron/issues/2407
		// https://stackoverflow.com/questions/54413142/how-can-i-modify-sweetalert2s-toast-animation-settings

		let alert = new Alert();
		swalOptions.toast = true;
		if (swalOptions.position === undefined) {
			swalOptions.position = "top-end";
		}
		return alert.fireFrameless(swalOptions, null, true, false, sound, size);
	}

	fire(swalOptions, bwOptions, parent, alwaysOnTop, draggable, sound) {
		// Create a unique id
		let uid = this.uid,
			head = this.head;

		var bwOptionsBase = {
			width: 800,
			height: 600,
			resizable: false,
			minimizable: false,
			maximizable: false,
			fullscreen: false,
			fullscreenable: false,
			webPreferences: {
				nodeIntegration: true,
				contextIsolation: false,
				devTools: this.devTools === true,
			},
		};

		var bwOptionsFinal = Object.assign(bwOptionsBase, bwOptions, {
			show: false,
		});

		// Force these settings
		if (parent !== undefined && parent !== null) {
			bwOptionsFinal["parent"] = parent;
			bwOptionsFinal["modal"] = true;
		}
		bwOptionsFinal.webPreferences.nodeIntegration = true;
		bwOptionsFinal.webPreferences.contextIsolation = false;
		bwOptionsFinal.webPreferences.enableRemoteModule = true;
		bwOptionsFinal.skipTaskbar = true;

		if (alwaysOnTop === true) {
			bwOptionsFinal["alwaysOnTop"] = alwaysOnTop;
		}

		if (draggable === true) {
			swalOptions.customClass = Object.assign(
				swalOptions.customClass ? swalOptions.customClass : {},
				{
					closeButton: "no-drag",
					confirmButton: "no-drag",
					cancelButton: "no-drag",
					denyButton: "no-drag",
					input: "no-drag",
				}
			);
		}

		// Hide vertical scrollbar
		swalOptions.customClass = Object.assign(
			swalOptions.customClass ? swalOptions.customClass : {},
			{
				container: "noscrollbar",
			}
		);

		this.browserWindow = new BrowserWindow(bwOptionsFinal);

		if (swalOptions.hasOwnProperty("singletonId")) {
			// Check if singletonId already exists in singletonIds
			if (singletonIds.hasOwnProperty(swalOptions.singletonId)) {
				singletonIds[swalOptions.singletonId].show();
				return new Promise((resolve, reject) => {
					resolve({ dismiss: DismissReason.showing });
				});
			} else {
				singletonIds[swalOptions.singletonId] = this.browserWindow;
			}
		}

		// For backward compatability with v8 of SweetAlert 2 (rename of type to icon)
		if (
			swalOptions.hasOwnProperty("type") &&
			!swalOptions.hasOwnProperty("icon")
		) {
			swalOptions["icon"] = swalOptions["type"];
		}

		let positions = {
			top: "topCenter",
			"top-start": "topLeft",
			"top-end": "topRight",
			center: "center",
			"center-start": "leftCenter",
			"center-end": "rightCenter",
			bottom: "bottomCenter",
			"bottom-start": "bottomLeft",
			"bottom-end": "bottomRight",
		};

		if (swalOptions.position) {
			this.position =
				positions[swalOptions.position] ||
				(swalOptions.toast === true ? "topRight" : "center");
		}

		if (!(isMac && (parent !== undefined && parent !== null))) {
			new Positioner(this.browserWindow).move(this.position);
		}

		let html = String.raw`
    <html>
      <head>
		<script type="text/javascript"><@insert-swal-lib@></script>
		<style>.noselect{-webkit-touch-callout:none;user-select:none;-webkit-user-select:none;-webkit-app-region:no-drag}.no-drag{-webkit-app-region:no-drag}.border-radius-0{border-radius:0}</style>
        <style>.noscrollbar{overflow-y: hidden !important;}</style>
        ${Array.isArray(head) ? head.join("\n") : ""}
      </head>
      <body draggable="false" class="noselect" ${
				draggable === true ? 'style="-webkit-app-region:drag"' : ""
			}>
      </body>
   		<script type="text/javascript">
      	let sound = ${JSON.stringify(sound)}
      	let config = ${JSON.stringify(swalOptions)}
				<@insert-renderer@>
			</script>
    </html>
    `;

		// Disable menu (and refresh shortcuts)
		this.browserWindow.setMenu(null);
		this.browserWindow.excludedFromShownWindowsMenu = true; // mac only

		// Save html
		let filepath = tempWrite.sync(html, "swal.html");

		this.browserWindow.loadURL("file://" + filepath);

		if (isMac && !bwOptionsFinal.noGlobalShortcut) {
			// Disable Window Refresh (Cmd+R)
			this.browserWindow.on("focus", (event) => {
				globalShortcut.registerAll(
					["CommandOrControl+R", "CommandOrControl+Shift+R"],
					() => {}
				);
			});

			this.browserWindow.on("blur", (event) => {
				globalShortcut.unregister("CommandOrControl+R");
				globalShortcut.unregister("CommandOrControl+Shift+R");
			});
		}

		this.browserWindow.once("ready-to-show", () => {
			if (!(isMac && (parent !== undefined && parent !== null))) {
				new Positioner(this.browserWindow).move(this.position);
			}
		});

		// For debugging only. Remove ASAP.
		ipcMain.on(uid + "log", (event, arg) => {
			console.log("from renderer: ", arg);
		});

		ipcMain.on(uid + "reposition", (event, arg) => {
			if (!(isMac && (parent !== undefined && parent !== null))) {
				new Positioner(this.browserWindow).move(this.position);
			}
			if (arg === "show") {
				this.browserWindow.show();
			}
			event.returnValue = "repositioned";
		});

		// Callbacks

		ipcMain.once(uid + "willOpen", (event, arg) => {
			if (swalOptions.hasOwnProperty("willOpen")) {
				swalOptions.willOpen(arg);
			} else {
				// For backward compatability
				if (swalOptions.hasOwnProperty("onBeforeOpen")) {
					swalOptions.onBeforeOpen(arg);
				}
			}
		});

		ipcMain.once(uid + "didClose", (event, arg) => {
			if (this.browserWindow) {
				this.browserWindow.destroy();
			}
		});

		ipcMain.once(uid + "didOpen", (event, arg) => {
			this._isVisible = true;
			if (swalOptions.hasOwnProperty("didOpen")) {
				swalOptions.didOpen(arg);
			} else {
				// For backward compatability
				if (swalOptions.hasOwnProperty("onOpen")) {
					swalOptions.onOpen(arg);
				}
			}
		});

		let willCloseSignalSent = false;
		ipcMain.once(uid + "willClose", (event, arg) => {
			this._isVisible = false;
			willCloseSignalSent = true;
			if (swalOptions.hasOwnProperty("willClose")) {
				swalOptions.willClose(arg);
			} else {
				// For backward compatability
				if (swalOptions.hasOwnProperty("onClose")) {
					swalOptions.onClose(arg);
				}
			}
		});

		this.browserWindow.once("close", () => {
			if (!willCloseSignalSent) {
				if (swalOptions.hasOwnProperty("willClose")) {
					swalOptions.willClose({});
				} else {
					// For backward compatability
					if (swalOptions.hasOwnProperty("onClose")) {
						swalOptions.onClose({});
					}
				}
			}
		});

		this.browserWindow.once("closed", () => {
			fs.unlink(filepath, (err) => {});

			if (!this.browserWindow.isDestroyed()) {
				this.browserWindow.destroy();
			}
			this.browserWindow = null;

			// Send signal that browserWindow is closed
			ipcMain.emit(uid + "return-promise", undefined, {
				dismiss: "close",
			});

			if (swalOptions.hasOwnProperty("didClose")) {
				swalOptions.didClose();
			} else {
				if (swalOptions.hasOwnProperty("onAfterClose")) {
					swalOptions.onAfterClose();
				}
			}

			if (isMac && !bwOptionsFinal.noGlobalShortcut) {
				// Disable Window Refresh (Cmd+R)
				globalShortcut.unregister("CommandOrControl+R");
				globalShortcut.unregister("CommandOrControl+Shift+R");
			}

			// Remove all listeners
			ipcMain.removeAllListeners([
				uid + "log",
				uid + "willOpen",
				uid + "didClose",
				uid + "didOpen",
				uid + "willClose",
				uid + "reposition",
				uid + "return-promise",
				uid + "resizeToFit",
			]);

			if (swalOptions.hasOwnProperty("singletonId")) {
				delete singletonIds[swalOptions.singletonId];
			}
		});

		return new Promise((resolve, reject) => {
			ipcMain.once(uid + "return-promise", (event, arg) => {
				resolve(arg);
			});
		});
	}

	execJS(javascript, callback) {
		if (this.browserWindow === null) {
			return new Promise((resolve) => {
				resolve();
			});
		}

		return this.browserWindow.webContents.executeJavaScript(
			javascript,
			false,
			callback
		);
	}

	static uncaughtException(hideTrace, closure, alwaysOnTop, cleanStack) {
		return (error) => {
			let html = exceptionFormatter(
				cleanStack === true
					? error.stack
						? cleanStak(error.stack)
						: error
					: error,
				{
					format: "html",
					inlineStyle: true,
				}
			);

			let alert = new Alert([], false);

			let swalOptions = {
				icon: "error",
			};

			if (hideTrace !== true) {
				swalOptions.html = `
				<div contenteditable="false" style="overflow:auto">
				${html}
				</div>
				`;
			} else {
				swalOptions.title = error.message;
			}

			if (closure) {
				swalOptions["didClose"] = () => {
					closure(error);
				};
			}

			alert.fireWithFrame(swalOptions, undefined, undefined, alwaysOnTop);
		};
	}
};
