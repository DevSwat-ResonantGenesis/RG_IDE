/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { localize, localize2 } from '../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { IChatWidgetService } from '../../chat.js';
import { CHAT_CATEGORY } from '../actions/chatActions.js';
import { ChatContextKeys } from '../../common/actions/chatContextKeys.js';

export class BrowserStartVoiceChatAction extends Action2 {

	static readonly ID = 'workbench.action.chat.browserStartVoiceChat';

	constructor() {
		super({
			id: BrowserStartVoiceChatAction.ID,
			title: localize2('workbench.action.chat.browserStartVoiceChat.label', "Voice Input"),
			category: CHAT_CATEGORY,
			icon: Codicon.mic,
			precondition: ChatContextKeys.enabled,
			menu: [{
				id: MenuId.ChatExecute,
				group: 'navigation',
				order: 2.5
			}]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const widgetService = accessor.get(IChatWidgetService);
		const widget = widgetService.lastFocusedWidget;
		if (!widget) {
			return;
		}

		// Focus the input
		widget.focusInput();

		// Use Web Speech API
		if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
			alert('Voice input is not supported in this browser.');
			return;
		}

		const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
		const recognition = new SpeechRecognition();
		recognition.continuous = true;
		recognition.interimResults = true;
		recognition.lang = 'en-US';

		let isRecording = false;
		let finalTranscript = '';

		recognition.onresult = (event: any) => {
			let interimTranscript = '';
			for (let i = event.resultIndex; i < event.results.length; i++) {
				const transcript = event.results[i][0].transcript;
				if (event.results[i].isFinal) {
					finalTranscript += transcript + ' ';
				} else {
					interimTranscript += transcript;
				}
			}
			if (interimTranscript) {
				widget.setInput(widget.getInput() + interimTranscript);
			}
		};

		recognition.onerror = (event: any) => {
			console.error('Speech recognition error:', event.error);
			recognition.stop();
			isRecording = false;
		};

		recognition.onend = () => {
			if (isRecording) {
				recognition.start();
			}
		};

		if (isRecording) {
			recognition.stop();
			isRecording = false;
		} else {
			recognition.start();
			isRecording = true;
		}
	}
}

export function registerBrowserVoiceChatActions() {
	registerAction2(BrowserStartVoiceChatAction);
}
