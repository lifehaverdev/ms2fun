import { Component } from '../../core/Component.js';
import { tradingStore } from '../../store/tradingStore.js';
import { eventBus } from '../../core/EventBus.js';

export class TransactionOptions extends Component {
    constructor() {
        super();
        this.store = tradingStore;
        this.eventBus = eventBus;
        
        // Initialize local state
        this.state = {
            nftMintingEnabled: false,
            message: '',
            isValid: true,
            nftBalance: 0,
            swapDirection: 'buy',
            lastValidationState: true
        };

        // Bind handlers
        this.handleMessageInput = this.handleMessageInput.bind(this);
        this.handleNFTToggle = this.handleNFTToggle.bind(this);
        this.handleStoreUpdate = this.handleStoreUpdate.bind(this);
        
        // Debounce timer for state updates
        this.updateTimer = null;
    }

    onMount() {
        this.unsubscribeStore = this.store.subscribe(() => this.handleStoreUpdate());
        this.addEventListeners();
    }

    onUnmount() {
        if (this.unsubscribeStore) this.unsubscribeStore();
        this.removeEventListeners();
    }

    addEventListeners() {
        const messageInput = this.element.querySelector('#messageInput');
        const nftToggle = this.element.querySelector('#nftToggle');

        if (!messageInput || !nftToggle) {
            console.error('TransactionOptions - Failed to find elements:', {
                messageInput: !!messageInput,
                nftToggle: !!nftToggle
            });
            return;
        }

        // Store references to elements
        this._messageInput = messageInput;
        this._nftToggle = nftToggle;

        messageInput.addEventListener('input', this.handleMessageInput);
        nftToggle.addEventListener('change', this.handleNFTToggle);
    }

    removeEventListeners() {
        
        if (this._messageInput) {
            this._messageInput.removeEventListener('input', this.handleMessageInput);
        }

        if (this._nftToggle) {
            this._nftToggle.removeEventListener('change', this.handleNFTToggle);
        }
    }

    validateTransaction() {
        const isMessageValid = this.state.message.length <= 140;
        const isNFTValid = !this.state.nftMintingEnabled || this.state.nftBalance < 10;
        const newIsValid = isMessageValid && isNFTValid;
        
        // Only emit if validation state has changed
        if (this.state.lastValidationState !== newIsValid) {
            this.state.lastValidationState = newIsValid;
            this.state.isValid = newIsValid;
            
            this.eventBus.emit('transactionValidation', {
                isValid: newIsValid,
                errors: this.getValidationErrors()
            });
        }
    }

    getValidationErrors() {
        const errors = [];
        
        if (this.state.message.length > 140) {
            errors.push('Message must be 140 characters or less');
        }
        
        if (this.state.nftMintingEnabled && this.state.nftBalance >= 10) {
            errors.push('Cannot mint more than 10 NFTs');
        }

        return errors;
    }

    updateElements() {
        
        // Update message input if it's not focused
        const messageInput = this.element.querySelector('#messageInput');
        const nftToggle = this.element.querySelector('#nftToggle');

        if (messageInput && !messageInput.matches(':focus')) {
            messageInput.value = this.state.message;
        }

        if (nftToggle) {
            nftToggle.checked = this.state.nftMintingEnabled;
        }

        // Re-attach event listeners after updating elements
        this.removeEventListeners();
        this.addEventListeners();

        // Update character count
        const characterCount = this.element.querySelector('.character-count');
        if (characterCount) {
            characterCount.textContent = `${this.state.message.length}/140`;
            characterCount.className = `character-count ${this.state.message.length > 140 ? 'error' : ''}`;
        }

        // Update validation status
        const validationStatus = this.element.querySelector('.validation-status');
        if (validationStatus) {
            validationStatus.className = `validation-status ${this.state.isValid ? 'valid' : 'invalid'}`;
            validationStatus.innerHTML = this.getValidationErrors()
                .map(error => `<p class="error">${error}</p>`)
                .join('');
        }
    }

    handleMessageInput(event) {
        const newMessage = event.target.value || '';
        
        // Update state without triggering a re-render
        this.state = {
            ...this.state,
            message: newMessage
        };
        
        // Update elements and ensure listeners
        this.updateElements();
        
        this.emitStateUpdate();
    }

    handleNFTToggle(event) {
        const isEnabled = event.target.checked;
        
        // Update state without triggering a re-render
        this.state = {
            ...this.state,
            nftMintingEnabled: isEnabled
        };
        
        // Update elements and ensure listeners
        this.updateElements();
        
        this.emitStateUpdate();
    }

    // New method to emit state updates
    emitStateUpdate() {
        const updatePayload = {
            message: this.state.message,
            nftMintingEnabled: this.state.nftMintingEnabled
        };
        this.eventBus.emit('transactionOptions:update', updatePayload);
    }

    handleStoreUpdate() {
        const direction = this.store.selectDirection();
        const balance = this.store.selectBalances().nft || 0;

        if (this.state.swapDirection !== (direction ? 'buy' : 'sell') ||
            this.state.nftBalance !== balance) {
            
            this.setState({
                ...this.state,
                swapDirection: direction ? 'buy' : 'sell',
                nftBalance: balance
            });
            
            this.validateTransaction();
            this.updateElements();
        }
    }

    setState(newState) {
        this.state = { ...this.state, ...newState };
        
        // First update the elements
        this.updateElements();
        
        // Then ensure event listeners are attached
        this.removeEventListeners(); // Remove old listeners first
        this.addEventListeners();    // Add fresh listeners
    }

    template() {
        const { nftMintingEnabled, message, isValid, swapDirection } = this.state;
        console.log('swap direction', swapDirection);
        return `
            <div class="transaction-options">
                <div class="option-group ${swapDirection === 'sell' ? 'hidden' : ''}">
                    <label class="nft-toggle">
                        <input type="checkbox" 
                               ${nftMintingEnabled ? 'checked' : ''} 
                               id="nftToggle">
                        Mint NFT with transaction
                    </label>
                </div>
                
                <div class="option-group">
                    <label for="messageInput">Transaction Message</label>
                    <textarea id="messageInput" 
                             maxlength="140" 
                             placeholder="Enter optional message..."
                             >${message}</textarea>
                    <span class="character-count ${message.length > 140 ? 'error' : ''}">
                        ${message.length}/140
                    </span>
                </div>

                <div class="validation-status ${isValid ? 'valid' : 'invalid'}">
                    ${this.getValidationErrors().map(error => `<p class="error">${error}</p>`).join('')}
                </div>
            </div>
        `;
    }

    render() {
        return this.template();
    }
} 