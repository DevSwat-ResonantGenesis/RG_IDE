import { Action2, MenuId } from '../../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { IChatWidgetService } from '../chat.js';
import { CHAT_CATEGORY } from './chatActions.js';
import { ISpeechService, SpeechToTextStatus } from '../../speech/common/speechService.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';

export class BrowserStartVoiceChatAction extends Action2 {
	static readonly ID = 'workbench.action.chat.startVoiceChat';

	private static cts: CancellationTokenSource | undefined;

	constructor() {
		super({
			id: BrowserStartVoiceChatAction.ID,
			title: { value: 'Start Voice Chat', original: 'Start Voice Chat' },
			category: CHAT_CATEGORY,
			f1: true,
			menu: [{
				id: MenuId.ChatInputSide,
				when: undefined,
				group: 'navigation',
				order: 2.5
			}]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const widgetService = accessor.get(IChatWidgetService);
		const speechService = accessor.get(ISpeechService);
		const widget = widgetService.lastFocusedWidget;

		if (!widget) {
			return;
		}

		if (BrowserStartVoiceChatAction.cts) {
			BrowserStartVoiceChatAction.cts.cancel();
			BrowserStartVoiceChatAction.cts.dispose();
			BrowserStartVoiceChatAction.cts = undefined;
			return;
		}

		BrowserStartVoiceChatAction.cts = new CancellationTokenSource();
		const disposables = new DisposableStore();

		const session = await speechService.createSpeechToTextSession(BrowserStartVoiceChatAction.cts.token);

		disposables.add(session.onDidChange(e => {
			if (e.status === SpeechToTextStatus.Recognizing || e.status === SpeechToTextStatus.Recognized) {
				if (e.text) {
					widget.setInput(e.text);
				}
			}
		}));

		disposables.add(BrowserStartVoiceChatAction.cts.token.onCancellationRequested(() => {
			disposables.dispose();
		}));
	}
}
