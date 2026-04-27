/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/chatStatus.css';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { IStatusbarEntryAccessor, IStatusbarService } from '../../../../services/statusbar/browser/statusbar.js';
import { ChatEntitlementService, IChatEntitlementService } from '../../../../services/chat/common/chatEntitlementService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IInlineCompletionsService } from '../../../../../editor/browser/services/inlineCompletionsService.js';
import { IChatSessionsService } from '../../common/chatSessionsService.js';

export class ChatStatusBarEntry extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.chatStatusBarEntry';

	private entry: IStatusbarEntryAccessor | undefined = undefined;

	constructor(
		@IChatEntitlementService _chatEntitlementService: ChatEntitlementService,
		@IInstantiationService _instantiationService: IInstantiationService,
		@IStatusbarService _statusbarService: IStatusbarService,
		@IEditorService _editorService: IEditorService,
		@IConfigurationService _configurationService: IConfigurationService,
		@IInlineCompletionsService _completionsService: IInlineCompletionsService,
		@IChatSessionsService _chatSessionsService: IChatSessionsService,
	) {
		super();

		// DevSwat IDE uses its own status bar — hide the built-in copilot icon
		this.update();
	}

	private update(): void {
		// DevSwat IDE uses its own status bar item — hide the built-in copilot icon entirely
		this.entry?.dispose();
		this.entry = undefined;
	}

	override dispose(): void {
		super.dispose();

		this.entry?.dispose();
		this.entry = undefined;
	}
}
