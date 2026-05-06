/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { localize2 } from '../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../../editor/browser/editorExtensions.js';
import { IChatWidgetService } from '../chat.js';
import { CHAT_CATEGORY } from './chatActions.js';

export class BrowserStartVoiceChatAction extends Action2 {

	static readonly ID = 'workbench.action.chat.browserStartVoiceChat';

	constructor() {
		super({
			id: BrowserStartVoiceChatAction.ID,
			title: localize2('workbench.action.chat.browserStartVoiceChat.label', "Voice Input"),
			category: CHAT_CATEGORY,
			icon: Codicon.mic,
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
		recognition.continuous = false;
		recognition.interimResults = false;
		recognition.lang = 'en-US';

		recognition.onresult = (event: any) => {
			const transcript = event.results[0][0].transcript;
			const currentText = widget.inputEditor.getValue();
			widget.inputEditor.setValue(currentText + transcript);
		};

		recognition.onerror = (event: any) => {
			console.error('Speech recognition error:', event.error);
		};

		recognition.start();
	}
}

export function registerBrowserVoiceChatActions() {
	registerAction2(BrowserStartVoiceChatAction);
}
