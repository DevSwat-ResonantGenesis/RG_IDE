/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, disposableWindowInterval, getWindow } from '../../../../../base/browser/dom.js';
import { ActionBar } from '../../../../../base/browser/ui/actionbar/actionbar.js';
import { Button } from '../../../../../base/browser/ui/button/button.js';
import { renderLabelWithIcons } from '../../../../../base/browser/ui/iconLabel/iconLabels.js';
import { IAction, toAction, WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification } from '../../../../../base/common/actions.js';
import { cancelOnDispose } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { safeIntl } from '../../../../../base/common/date.js';
import { MutableDisposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { parseLinkedText } from '../../../../../base/common/linkedText.js';
import { language } from '../../../../../base/common/platform.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { IInlineCompletionsService } from '../../../../../editor/browser/services/inlineCompletionsService.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { ITextResourceConfigurationService } from '../../../../../editor/common/services/textResourceConfiguration.js';
import { ILanguageFeaturesService } from '../../../../../editor/common/services/languageFeatures.js';
import { IQuickInputService, IQuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';
import * as languages from '../../../../../editor/common/languages.js';
import { localize } from '../../../../../nls.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IHoverService, nativeHoverDelegate } from '../../../../../platform/hover/browser/hover.js';
import { IMarkdownRendererService } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import { Link } from '../../../../../platform/opener/browser/link.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { defaultButtonStyles } from '../../../../../platform/theme/browser/defaultStyles.js';
import { DomWidget } from '../../../../../platform/domWidget/browser/domWidget.js';
import { IChatEntitlementService, ChatEntitlementService, ChatEntitlement, IQuotaSnapshot, getChatPlanName } from '../../../../services/chat/common/chatEntitlementService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IChatSessionsService } from '../../common/chatSessionsService.js';
import { IChatStatusItemService, ChatStatusEntry } from './chatStatusItemService.js';
import product from '../../../../../platform/product/common/product.js';
import { contrastBorder, inputValidationErrorBorder, inputValidationInfoBorder, inputValidationWarningBorder, registerColor, transparent } from '../../../../../platform/theme/common/colorRegistry.js';
import { Color } from '../../../../../base/common/color.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { ChatViewId } from '../chat.js';
import { isCompletionsEnabled } from '../../../../../editor/common/services/completionsEnablement.js';

const defaultChat = product.defaultChatAgent;


const gaugeForeground = registerColor('gauge.foreground', {
	dark: inputValidationInfoBorder,
	light: inputValidationInfoBorder,
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('gaugeForeground', "Gauge foreground color."));

registerColor('gauge.background', {
	dark: transparent(gaugeForeground, 0.3),
	light: transparent(gaugeForeground, 0.3),
	hcDark: Color.white,
	hcLight: Color.white
}, localize('gaugeBackground', "Gauge background color."));

registerColor('gauge.border', {
	dark: null,
	light: null,
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('gaugeBorder', "Gauge border color."));

const gaugeWarningForeground = registerColor('gauge.warningForeground', {
	dark: inputValidationWarningBorder,
	light: inputValidationWarningBorder,
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('gaugeWarningForeground', "Gauge warning foreground color."));

registerColor('gauge.warningBackground', {
	dark: transparent(gaugeWarningForeground, 0.3),
	light: transparent(gaugeWarningForeground, 0.3),
	hcDark: Color.white,
	hcLight: Color.white
}, localize('gaugeWarningBackground', "Gauge warning background color."));

const gaugeErrorForeground = registerColor('gauge.errorForeground', {
	dark: inputValidationErrorBorder,
	light: inputValidationErrorBorder,
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('gaugeErrorForeground', "Gauge error foreground color."));

registerColor('gauge.errorBackground', {
	dark: transparent(gaugeErrorForeground, 0.3),
	light: transparent(gaugeErrorForeground, 0.3),
	hcDark: Color.white,
	hcLight: Color.white
}, localize('gaugeErrorBackground', "Gauge error background color."));

export class ChatStatusDashboard extends DomWidget {

	readonly element = $('div.chat-status-bar-entry-tooltip');

	private readonly dateFormatter = safeIntl.DateTimeFormat(language, { year: 'numeric', month: 'long', day: 'numeric' });
	private readonly dateTimeFormatter = safeIntl.DateTimeFormat(language, { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric' });
	private readonly quotaPercentageFormatter = safeIntl.NumberFormat(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 0 });
	private readonly quotaOverageFormatter = safeIntl.NumberFormat(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 });

	constructor(
		@IChatEntitlementService private readonly chatEntitlementService: ChatEntitlementService,
		@IChatStatusItemService private readonly chatStatusItemService: IChatStatusItemService,
		@ICommandService private readonly commandService: ICommandService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IEditorService private readonly editorService: IEditorService,
		@IHoverService private readonly hoverService: IHoverService,
		@ILanguageService _languageService: ILanguageService,
		@IOpenerService private readonly openerService: IOpenerService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@ITextResourceConfigurationService _textResourceConfigurationService: ITextResourceConfigurationService,
		@IInlineCompletionsService private readonly inlineCompletionsService: IInlineCompletionsService,
		@IChatSessionsService private readonly chatSessionsService: IChatSessionsService,
		@IMarkdownRendererService _markdownRendererService: IMarkdownRendererService,
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IViewsService private readonly viewService: IViewsService,
	) {
		super();

		this.render();
	}

	private render(): void {
		const token = cancelOnDispose(this._store);

		let needsSeparator = false;
		const addSeparator = (label?: string, action?: IAction) => {
			if (needsSeparator) {
				this.element.appendChild($('hr'));
			}

			if (label || action) {
				this.renderHeader(this.element, this._store, label ?? '', action);
			}

			needsSeparator = true;
		};

		// Quota Indicator
		const { chat: chatQuota, completions: completionsQuota, premiumChat: premiumChatQuota, resetDate, resetDateHasTime } = this.chatEntitlementService.quotas;
		if (chatQuota || completionsQuota || premiumChatQuota) {
			const usageTitle = this.getUsageTitle();
			addSeparator(usageTitle, toAction({
				id: 'workbench.action.manageCopilot',
				label: localize('quotaLabel', "Manage Chat"),
				tooltip: localize('quotaTooltip', "Manage Chat"),
				class: ThemeIcon.asClassName(Codicon.settings),
				run: () => this.runCommandAndClose(() => this.openerService.open(URI.parse(defaultChat.manageSettingsUrl))),
			}));

			// Inline Suggestions quota removed — Resonant IDE uses its own completion system
			const chatQuotaIndicator = chatQuota && (chatQuota.total > 0 || chatQuota.unlimited) ? this.createQuotaIndicator(this.element, this._store, chatQuota, localize('chatsLabel', "Chat messages"), false) : undefined;
			const premiumChatLabel = premiumChatQuota?.overageEnabled && !premiumChatQuota?.unlimited ? localize('includedPremiumChatsLabel', "Included premium requests") : localize('premiumChatsLabel', "Premium requests");
			const premiumChatQuotaIndicator = premiumChatQuota && (premiumChatQuota.total > 0 || premiumChatQuota.unlimited) ? this.createQuotaIndicator(this.element, this._store, premiumChatQuota, premiumChatLabel, true) : undefined;

			if (resetDate) {
				this.element.appendChild($('div.description', undefined, localize('limitQuota', "Allowance resets {0}.", resetDateHasTime ? this.dateTimeFormatter.value.format(new Date(resetDate)) : this.dateFormatter.value.format(new Date(resetDate)))));
			}

			if (this.chatEntitlementService.entitlement === ChatEntitlement.Free && Number(chatQuota?.percentRemaining) <= 25) {
				const upgradeProButton = this._store.add(new Button(this.element, { ...defaultButtonStyles, hoverDelegate: nativeHoverDelegate, secondary: this.canUseChat() /* use secondary color when chat can still be used */ }));
				upgradeProButton.label = localize('upgradeToCopilotPro', "Upgrade to Resonant Pro");
				this._store.add(upgradeProButton.onDidClick(() => this.runCommandAndClose('workbench.action.chat.upgradePlan')));
			}

			(async () => {
				await this.chatEntitlementService.update(token);
				if (token.isCancellationRequested) {
					return;
				}

				const { chat: chatQuota, premiumChat: premiumChatQuota } = this.chatEntitlementService.quotas;
				if (chatQuota) {
					chatQuotaIndicator?.(chatQuota);
				}
				if (premiumChatQuota) {
					premiumChatQuotaIndicator?.(premiumChatQuota);
				}
			})();
		}

		// Anonymous Indicator
		else if (this.chatEntitlementService.anonymous && this.chatEntitlementService.sentiment.installed) {
			addSeparator(localize('anonymousTitle', "Resonant AI Usage"));

			this.createQuotaIndicator(this.element, this._store, localize('quotaLimited', "Limited"), localize('chatsLabel', "Chat messages"), false);
		}

		// Chat sessions
		{
			const inProgress = this.chatSessionsService.getInProgress();
			if (inProgress.some(item => item.count > 0)) {

				addSeparator(localize('chatAgentSessionsTitle', "Agent Sessions"), toAction({
					id: 'workbench.view.chat.status.sessions',
					label: localize('viewChatSessionsLabel', "View Agent Sessions"),
					tooltip: localize('viewChatSessionsTooltip', "View Agent Sessions"),
					class: ThemeIcon.asClassName(Codicon.eye),
					run: () => {
						this.viewService.openView(ChatViewId, true);
						this.hoverService.hideHover(true);
					}
				}));

				for (const { displayName, count } of inProgress) {
					if (count > 0) {
						const text = localize('inProgressChatSession', "$(loading~spin) {0} in progress", displayName);
						const chatSessionsElement = this.element.appendChild($('div.description'));
						const parts = renderLabelWithIcons(text);
						chatSessionsElement.append(...parts);
					}
				}
			}
		}

		// Contributions
		{
			for (const item of this.chatStatusItemService.getEntries()) {
				addSeparator();

				const itemDisposables = this._store.add(new MutableDisposable());

				let rendered = this.renderContributedChatStatusItem(item);
				itemDisposables.value = rendered.disposables;
				this.element.appendChild(rendered.element);

				this._store.add(this.chatStatusItemService.onDidChange(e => {
					if (e.entry.id === item.id) {
						const previousElement = rendered.element;

						rendered = this.renderContributedChatStatusItem(e.entry);
						itemDisposables.value = rendered.disposables;

						previousElement.replaceWith(rendered.element);
					}
				}));
			}
		}

		// Inline Suggestions settings removed — Resonant IDE uses its own completion system

		// Model Selection
		{
			const providers = this.languageFeaturesService.inlineCompletionsProvider.allNoModel();
			const provider = providers.find(p => p.modelInfo && p.modelInfo.models.length > 0);

			if (provider) {
				const modelInfo = provider.modelInfo!;
				const currentModel = modelInfo.models.find(m => m.id === modelInfo.currentModelId);

				if (currentModel) {
					const modelContainer = this.element.appendChild($('div.model-selection'));

					modelContainer.appendChild($('span.model-text', undefined, localize('modelLabel', "Model")));

					const actionBar = modelContainer.appendChild($('div.model-action-bar'));
					const toolbar = this._store.add(new ActionBar(actionBar, { hoverDelegate: nativeHoverDelegate }));
					toolbar.push([toAction({
						id: 'workbench.action.selectInlineCompletionsModel',
						label: currentModel.name,
						tooltip: localize('selectModel', "Select Model"),
						class: ThemeIcon.asClassName(Codicon.gear),
						run: async () => {
							await this.showModelPicker(provider);
						}
					})], { icon: false, label: true });
				}
			}
		}

		// Provider Options
		{
			const providers = this.languageFeaturesService.inlineCompletionsProvider.allNoModel();
			for (const provider of providers) {
				if (provider.providerOptions && provider.providerOptions.length > 0) {
					for (const option of provider.providerOptions) {
						const currentValue = option.values.find(v => v.id === option.currentValueId);
						if (currentValue) {
							const optionContainer = this.element.appendChild($('div.suggest-option-selection'));

							optionContainer.appendChild($('span.suggest-option-text', undefined, option.label));

							const actionBar = optionContainer.appendChild($('div.suggest-option-action-bar'));
							const toolbar = this._store.add(new ActionBar(actionBar, { hoverDelegate: nativeHoverDelegate }));
							toolbar.push([toAction({
								id: `workbench.action.selectProviderOption.${option.id}`,
								label: currentValue.label,
								tooltip: localize('selectOption', "Select {0}", option.label),
								run: async () => {
									await this.showProviderOptionPicker(provider, option);
								}
							})], { icon: false, label: true });
						}
					}
				}
			}
		}

		// Completions Snooze
		if (this.canUseChat()) {
			const snooze = append(this.element, $('div.snooze-completions'));
			this.createCompletionsSnooze(snooze, localize('settings.snooze', "Snooze"), this._store);
		}

	}

	private canUseChat(): boolean {
		if (!this.chatEntitlementService.sentiment.installed || this.chatEntitlementService.sentiment.disabled || this.chatEntitlementService.sentiment.untrusted) {
			return false; // chat not installed or not enabled
		}

		if (this.chatEntitlementService.entitlement === ChatEntitlement.Unknown || this.chatEntitlementService.entitlement === ChatEntitlement.Available) {
			return this.chatEntitlementService.anonymous; // signed out or not-yet-signed-up users can only use Chat if anonymous access is allowed
		}

		if (this.chatEntitlementService.entitlement === ChatEntitlement.Free && this.chatEntitlementService.quotas.chat?.percentRemaining === 0 && this.chatEntitlementService.quotas.completions?.percentRemaining === 0) {
			return false; // free user with no quota left
		}

		return true;
	}

	private getUsageTitle(): string {
		const planName = getChatPlanName(this.chatEntitlementService.entitlement);
		return localize('usageTitleWithPlan', "{0} Usage", planName);
	}

	private renderHeader(container: HTMLElement, disposables: DisposableStore, label: string, action?: IAction): void {
		const header = container.appendChild($('div.header', undefined, label ?? ''));

		if (action) {
			const toolbar = disposables.add(new ActionBar(header, { hoverDelegate: nativeHoverDelegate }));
			toolbar.push([action], { icon: true, label: false });
		}
	}

	private renderContributedChatStatusItem(item: ChatStatusEntry): { element: HTMLElement; disposables: DisposableStore } {
		const disposables = new DisposableStore();

		const itemElement = $('div.contribution');

		const headerLabel = typeof item.label === 'string' ? item.label : item.label.label;
		const headerLink = typeof item.label === 'string' ? undefined : item.label.link;
		this.renderHeader(itemElement, disposables, headerLabel, headerLink ? toAction({
			id: 'workbench.action.openChatStatusItemLink',
			label: localize('learnMore', "Learn More"),
			tooltip: localize('learnMore', "Learn More"),
			class: ThemeIcon.asClassName(Codicon.linkExternal),
			run: () => this.runCommandAndClose(() => this.openerService.open(URI.parse(headerLink))),
		}) : undefined);

		const itemBody = itemElement.appendChild($('div.body'));

		const description = itemBody.appendChild($('span.description'));
		this.renderTextPlus(description, item.description, disposables);

		if (item.detail) {
			const detail = itemBody.appendChild($('div.detail-item'));
			this.renderTextPlus(detail, item.detail, disposables);
		}

		return { element: itemElement, disposables };
	}

	private renderTextPlus(target: HTMLElement, text: string, store: DisposableStore): void {
		for (const node of parseLinkedText(text).nodes) {
			if (typeof node === 'string') {
				const parts = renderLabelWithIcons(node);
				target.append(...parts);
			} else {
				store.add(new Link(target, node, undefined, this.hoverService, this.openerService));
			}
		}
	}

	private runCommandAndClose(commandOrFn: string | Function, ...args: unknown[]): void {
		if (typeof commandOrFn === 'function') {
			commandOrFn(...args);
		} else {
			this.telemetryService.publicLog2<WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification>('workbenchActionExecuted', { id: commandOrFn, from: 'chat-status' });
			this.commandService.executeCommand(commandOrFn, ...args);
		}

		this.hoverService.hideHover(true);
	}

	private createQuotaIndicator(container: HTMLElement, disposables: DisposableStore, quota: IQuotaSnapshot | string, label: string, supportsOverage: boolean): (quota: IQuotaSnapshot | string) => void {
		const quotaValue = $('span.quota-value');
		const quotaBit = $('div.quota-bit');
		const overageLabel = $('span.overage-label');

		const quotaIndicator = container.appendChild($('div.quota-indicator', undefined,
			$('div.quota-label', undefined,
				$('span', undefined, label),
				quotaValue
			),
			$('div.quota-bar', undefined,
				quotaBit
			),
			$('div.description', undefined,
				overageLabel
			)
		));

		if (supportsOverage && (this.chatEntitlementService.entitlement === ChatEntitlement.Pro || this.chatEntitlementService.entitlement === ChatEntitlement.ProPlus)) {
			const manageOverageButton = disposables.add(new Button(quotaIndicator, { ...defaultButtonStyles, secondary: true, hoverDelegate: nativeHoverDelegate }));
			manageOverageButton.label = localize('enableAdditionalUsage', "Manage paid premium requests");
			disposables.add(manageOverageButton.onDidClick(() => this.runCommandAndClose(() => this.openerService.open(URI.parse(defaultChat.manageOverageUrl)))));
		}

		const update = (quota: IQuotaSnapshot | string) => {
			quotaIndicator.classList.remove('error');
			quotaIndicator.classList.remove('warning');

			let usedPercentage: number;
			if (typeof quota === 'string' || quota.unlimited) {
				usedPercentage = 0;
			} else {
				usedPercentage = Math.max(0, 100 - quota.percentRemaining);
			}

			if (typeof quota === 'string') {
				quotaValue.textContent = quota;
			} else if (quota.unlimited) {
				quotaValue.textContent = localize('quotaUnlimited', "Included");
			} else if (quota.overageCount) {
				quotaValue.textContent = localize('quotaDisplayWithOverage', "+{0} requests", this.quotaOverageFormatter.value.format(quota.overageCount));
			} else {
				quotaValue.textContent = localize('quotaDisplay', "{0}%", this.quotaPercentageFormatter.value.format(usedPercentage));
			}

			quotaBit.style.width = `${usedPercentage}%`;

			const overageEnabled = supportsOverage && typeof quota !== 'string' && quota?.overageEnabled;
			if (usedPercentage >= 90 && !overageEnabled) {
				quotaIndicator.classList.add('error');
			} else if (usedPercentage >= 75 && !overageEnabled) {
				quotaIndicator.classList.add('warning');
			}

			if (supportsOverage) {
				if (typeof quota !== 'string' && quota.unlimited) {
					overageLabel.textContent = '';
				} else if (typeof quota !== 'string' && quota?.overageEnabled) {
					overageLabel.replaceChildren(
						localize('additionalUsageApprovedLine1', "Additional premium requests approved."),
						$('br'),
						localize('additionalUsageApprovedLine2', "You can continue after the included premium requests limit reaches 100%.")
					);
				} else {
					overageLabel.textContent = localize('additionalUsageDisabled', "Additional paid premium requests disabled.");
				}
			} else {
				overageLabel.textContent = '';
			}
		};

		update(quota);

		return update;
	}

	private createCompletionsSnooze(container: HTMLElement, label: string, disposables: DisposableStore): void {
		const isEnabled = () => {
			const completionsEnabled = isCompletionsEnabled(this.configurationService);
			const completionsEnabledActiveLanguage = isCompletionsEnabled(this.configurationService, this.editorService.activeTextEditorLanguageId);
			return completionsEnabled || completionsEnabledActiveLanguage;
		};

		const button = disposables.add(new Button(container, { disabled: !isEnabled(), ...defaultButtonStyles, hoverDelegate: nativeHoverDelegate, secondary: true }));

		const timerDisplay = container.appendChild($('span.snooze-label'));

		const actionBar = container.appendChild($('div.snooze-action-bar'));
		const toolbar = disposables.add(new ActionBar(actionBar, { hoverDelegate: nativeHoverDelegate }));
		const cancelAction = toAction({
			id: 'workbench.action.cancelSnoozeStatusBarLink',
			label: localize('cancelSnooze', "Cancel Snooze"),
			run: () => this.inlineCompletionsService.cancelSnooze(),
			class: ThemeIcon.asClassName(Codicon.stopCircle)
		});

		const update = (isEnabled: boolean) => {
			container.classList.toggle('disabled', !isEnabled);
			toolbar.clear();

			const timeLeftMs = this.inlineCompletionsService.snoozeTimeLeft;
			if (!isEnabled || timeLeftMs <= 0) {
				timerDisplay.textContent = localize('completions.snooze5minutesTitle', "Hide suggestions for 5 min");
				timerDisplay.title = '';
				button.label = label;
				button.setTitle(localize('completions.snooze5minutes', "Hide inline suggestions for 5 min"));
				return true;
			}

			const timeLeftSeconds = Math.ceil(timeLeftMs / 1000);
			const minutes = Math.floor(timeLeftSeconds / 60);
			const seconds = timeLeftSeconds % 60;

			timerDisplay.textContent = `${minutes}:${seconds < 10 ? '0' : ''}${seconds} ${localize('completions.remainingTime', "remaining")}`;
			timerDisplay.title = localize('completions.snoozeTimeDescription', "Inline suggestions are hidden for the remaining duration");
			button.label = localize('completions.plus5min', "+5 min");
			button.setTitle(localize('completions.snoozeAdditional5minutes', "Snooze additional 5 min"));
			toolbar.push([cancelAction], { icon: true, label: false });

			return false;
		};

		// Update every second if there's time remaining
		const timerDisposables = disposables.add(new DisposableStore());
		function updateIntervalTimer() {
			timerDisposables.clear();
			const enabled = isEnabled();

			if (update(enabled)) {
				return;
			}

			timerDisposables.add(disposableWindowInterval(
				getWindow(container),
				() => update(enabled),
				1000
			));
		}
		updateIntervalTimer();

		disposables.add(button.onDidClick(() => {
			this.inlineCompletionsService.snooze();
			update(isEnabled());
		}));

		disposables.add(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(defaultChat.completionsEnablementSetting)) {
				button.enabled = isEnabled();
			}
			updateIntervalTimer();
		}));

		disposables.add(this.inlineCompletionsService.onDidChangeIsSnoozing(e => {
			updateIntervalTimer();
		}));
	}

	private async showModelPicker(provider: languages.InlineCompletionsProvider): Promise<void> {
		if (!provider.modelInfo || !provider.setModelId) {
			return;
		}

		const modelInfo = provider.modelInfo;
		const items: IQuickPickItem[] = modelInfo.models.map(model => ({
			id: model.id,
			label: model.name,
			description: model.id === modelInfo.currentModelId ? localize('currentModel.description', "Currently selected") : undefined,
			picked: model.id === modelInfo.currentModelId
		}));

		const selected = await this.quickInputService.pick(items, {
			placeHolder: localize('selectModelFor', "Select a model for {0}", provider.displayName || 'inline completions'),
			canPickMany: false
		});

		if (selected && selected.id && selected.id !== modelInfo.currentModelId) {
			await provider.setModelId(selected.id);
		}

		this.hoverService.hideHover(true);
	}

	private async showProviderOptionPicker(provider: languages.InlineCompletionsProvider, option: languages.IInlineCompletionProviderOption): Promise<void> {
		if (!provider.setProviderOption) {
			return;
		}

		const items: IQuickPickItem[] = option.values.map(value => ({
			id: value.id,
			label: value.label,
			description: value.id === option.currentValueId ? localize('currentOption.description', "Currently selected") : undefined,
			picked: value.id === option.currentValueId,
		}));

		const selected = await this.quickInputService.pick(items, {
			placeHolder: localize('selectProviderOptionFor', "Select {0}", option.label),
			canPickMany: false
		});

		if (selected && selected.id && selected.id !== option.currentValueId) {
			await provider.setProviderOption(option.id, selected.id);
		}

		this.hoverService.hideHover(true);
	}
}
