import { ISpeechService, ISpeechProvider, ISpeechToTextSession, SpeechToTextStatus, SpeechToTextEvent } from '../common/speechService.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { registerSingleton } from '../../../../../platform/instantiation/common/extensions.js';

export class WebSpeechProvider extends Disposable implements ISpeechProvider {
	readonly metadata = { name: 'Web Speech API' };

	createSpeechToTextSession(): ISpeechToTextSession {
		const emitter = new Emitter<SpeechToTextEvent>();
		const recognition = new (window as any).webkitSpeechRecognition();
		recognition.continuous = true;
		recognition.interimResults = true;

		recognition.onstart = () => emitter.fire({ status: SpeechToTextStatus.Started });
		recognition.onresult = (event: any) => {
			const result = event.results[event.results.length - 1];
			emitter.fire({
				status: SpeechToTextStatus.Recognizing,
				text: result[0].transcript,
				isFinal: result.isFinal
			});
		};
		recognition.onerror = (event: any) => emitter.fire({ status: SpeechToTextStatus.Error, text: event.error });
		recognition.onend = () => emitter.fire({ status: SpeechToTextStatus.Stopped });

		recognition.start();

		return {
			onDidChange: emitter.event,
			dispose: () => {
				recognition.stop();
				emitter.dispose();
			}
		};
	}
}

export class SpeechService extends Disposable implements ISpeechService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidRegisterProvider = this._register(new Emitter<ISpeechProvider>());
	readonly onDidRegisterProvider = this._onDidRegisterProvider.event;

	private readonly providers = new Map<string, ISpeechProvider>();

	constructor() {
		super();
		// Register built-in provider
		this.registerSpeechProvider('web-speech', new WebSpeechProvider());
	}

	registerSpeechProvider(identifier: string, provider: ISpeechProvider): IDisposable {
		this.providers.set(identifier, provider);
		this._onDidRegisterProvider.fire(provider);

		return {
			dispose: () => this.providers.delete(identifier)
		};
	}

	createSpeechToTextSession(identifier?: string): ISpeechToTextSession {
		const provider = identifier ? this.providers.get(identifier) : Array.from(this.providers.values())[0];
		if (!provider) {
			throw new Error('No speech provider available');
		}
		return provider.createSpeechToTextSession();
	}
}

registerSingleton(ISpeechService, SpeechService, true);
