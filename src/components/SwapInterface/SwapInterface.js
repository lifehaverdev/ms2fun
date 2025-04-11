import {Component} from '../../core/Component.js';
import { tradingStore } from '../../store/tradingStore.js';
import { TransactionOptions } from '../TransactionOptions/TransactionOptions.js';
import MessagePopup from '../MessagePopup/MessagePopup.js';
import { eventBus } from '../../core/EventBus.js';
import PriceDisplay  from '../PriceDisplay/PriceDisplay.js';
import { ApproveModal } from '../ApprovalModal/ApprovalModal.js';

export default class SwapInterface extends Component {
    constructor(blockchainService , address = null) {
        super();
        console.log('🔵 SwapInterface constructed');
        this.blockchainService = blockchainService;
        this.store = tradingStore;
        this.state = {
            direction: 'buy',
            ethAmount: '',
            execAmount: '',
            activeInput: null,
            freeMint: false,
            freeSupply: 0,
            calculatingAmount: false,
            isPhase2: false,
            dataReady: false
        };
        
        // Store the address - could be a promise or a direct value
        this._address = address;
        
        // Initialize child components
        this.transactionOptions = new TransactionOptions();
        this.messagePopup = new MessagePopup('status-message');
        this.priceDisplay = new PriceDisplay();
        console.log('🔵 SwapInterface created PriceDisplay instance');
        this.messagePopup.initialize();
        
        // Debounce timer
        this.calculateTimer = null;
        
        // Bind event handlers
        this.handleTransactionEvents = this.handleTransactionEvents.bind(this);
        this.handleBalanceUpdate = this.handleBalanceUpdate.bind(this);
        
        // Add handler for transaction options updates
        this.handleTransactionOptionsUpdate = this.handleTransactionOptionsUpdate.bind(this);
        
        // Add transaction options state to SwapInterface
        this.transactionOptionsState = {
            message: '',
            nftMintingEnabled: false
        };

        this.approveModal = null;
        
        // Track event listeners
        this.eventListeners = [];
        
        // Add instance ID to track instances and prevent duplicate events
        this.instanceId = Math.random().toString(36).substring(2, 9);
        console.log(`🔵 SwapInterface instance created: ${this.instanceId}`);
    }

    // Add new method to handle balance updates
    handleBalanceUpdate() {
        // Update only the balance displays without full re-render
        const balances = this.store.selectBalances();
        const formattedEthBalance = parseFloat(balances.eth).toFixed(6);
        const formattedExecBalance = parseInt(balances.exec).toLocaleString();

        const { freeSupply, freeMint } = this.store.selectFreeSituation();
        console.log('handleBalanceUpdate freeMint', freeMint);
        this.freeMint = freeMint;
        this.freeSupply = freeSupply;

        // Update all balance displays
        const balanceDisplays = this.element.querySelectorAll('.token-balance');
        balanceDisplays.forEach(display => {
            const isEthBalance = display.previousElementSibling.textContent.includes('ETH');
            display.textContent = `Balance: ${isEthBalance ? formattedEthBalance : formattedExecBalance}`;
        });
    }

    updateElements() {
        const { activeInput, calculatingAmount, direction } = this.state;
        
        // Update inactive input
        if (activeInput === 'top') {
            const bottomInput = this.element.querySelector('.bottom-input');
            if (bottomInput && !bottomInput.matches(':focus')) {
                bottomInput.value = calculatingAmount ? 'Loading...' : 
                    (direction === 'buy' ? this.state.execAmount : this.state.ethAmount);
            }
        } else if (activeInput === 'bottom') {
            const topInput = this.element.querySelector('.top-input');
            if (topInput && !topInput.matches(':focus')) {
                topInput.value = calculatingAmount ? 'Loading...' : 
                    (direction === 'buy' ? this.state.ethAmount : this.state.execAmount);
            }
        }

        // Update action button
        const actionButton = this.element.querySelector('.swap-button');
        if (actionButton) {
            actionButton.textContent = this.state.direction === 'buy' ? 'Buy $EXEC' : 'Sell $EXEC';
        }
    }

    async calculateSwapAmount(amount, inputType) {
        // Handle empty or invalid input
        if (!amount || isNaN(parseFloat(amount))) {
            return '';
        }

        try {
            if (this.isLiquidityDeployed()) {
                // Phase 2: Use Uniswap-style calculations
                const price = this.store.selectPrice().current;
                console.log('calculateSwapAmount price', price);
                
                if (inputType === 'eth') {
                    // Calculate EXEC amount based on ETH input
                    const ethAmount = parseFloat(amount);
                    // Apply a 5% reduction to account for 4% tax + slippage
                    const execAmount = (ethAmount / price * 1000000) * 0.95;
                    console.log('calculateSwapAmount execAmount', execAmount);
                    return execAmount.toFixed(0); // Use integer amounts for EXEC
                } else {
                    // Calculate ETH amount based on EXEC input
                    const execAmount = parseFloat(amount);
                    // Add a 5.5% buffer for 4% tax + slippage + price impact
                    const ethAmount = (execAmount / 1000000) * price * 1.055;
                    console.log('calculateSwapAmount ethAmount', ethAmount);
                    return ethAmount.toFixed(6);
                }
            } else {
                // Phase 1: Use bonding curve logic
                if (inputType === 'eth') {
                    // Calculate how much EXEC user will receive for their ETH
                    const execAmount = await this.blockchainService.getExecForEth(amount);

                    // Check if user is eligible for free mint
                    const { freeSupply, freeMint } = this.store.selectFreeSituation();
                    console.log('calculateSwapAmount freeMint', freeMint);
                    // If free supply is available and user hasn't claimed their free mint
                    const freeMintBonus = (freeSupply > 0 && !freeMint) ? 1000000 : 0;
                    
                    // Round down to ensure we don't exceed maxCost
                    return Math.floor(execAmount + freeMintBonus).toString();
                } else {
                    // Calculate how much ETH user will receive for their EXEC
                    const ethAmount = await this.blockchainService.getEthForExec(amount);
                    // Reduce the minRefund slightly (0.1% less) to account for any calculation differences
                    // This ensures we stay above the actual minRefund requirement

                    // Update lets do this tailoring amount at the contract call in handle swap
                    return ethAmount.toString(); // Use more decimals for precision
                }
            }
        } catch (error) {
            console.error('Error calculating swap amount:', error);
            return '';
        }
    }

    onMount() {
        console.log(`[${this.instanceId}] SwapInterface.onMount`);
        
        // First unbind any existing events to prevent duplicates
        this.unbindEvents();
        
        // Then bind DOM events
        this.bindEvents();
        
        // Clear any existing event listeners first
        this.eventListeners.forEach(unsubscribe => {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        });
        this.eventListeners = [];
        
        // Store the unsubscribe function for contract data updates
        this.eventListeners.push(
            eventBus.on('contractData:updated', this.handleContractDataUpdate.bind(this))
        );

        // Check if we already have data
        const contractData = this.store.selectContractData();
        if (contractData) {
            this.setState({ 
                isPhase2: this.isLiquidityDeployed(),
                dataReady: true
            });
        }

        // Mount transaction options
        const optionsContainer = this.element.querySelector('.transaction-options-container');
        if (optionsContainer) {
            if (this.transactionOptions) {
                this.transactionOptions.mount(optionsContainer);
            }
        }

        // Mount PriceDisplay if not already mounted
        const priceContainer = this.element.querySelector('.price-display-container');
        if (priceContainer && !this.priceDisplay.element) {
            console.log('📊 SwapInterface.onMount - Mounting PriceDisplay');
            this.priceDisplay.mount(priceContainer);
        }

        // Subscribe to transaction events - store handlers to properly unsubscribe later
        console.log(`[${this.instanceId}] Subscribing to transaction events`);
        this.eventListeners.push(
            eventBus.on('transaction:pending', this.handleTransactionEvents),
            eventBus.on('transaction:confirmed', this.handleTransactionEvents),
            eventBus.on('transaction:success', this.handleTransactionEvents),
            eventBus.on('transaction:error', this.handleTransactionEvents),
            eventBus.on('balances:updated', this.handleBalanceUpdate),
            eventBus.on('transactionOptions:update', this.handleTransactionOptionsUpdate)
        );
    }

    onUnmount() {
        console.log(`[${this.instanceId}] Unmounting SwapInterface`);
        
        if (this.transactionOptions) {
            this.transactionOptions.unmount();
        }
        
        if (this.priceDisplay) {
            this.priceDisplay.unmount();
        }
        
        // Clear any pending timers
        if (this.calculateTimer) {
            clearTimeout(this.calculateTimer);
            this.calculateTimer = null;
        }

        // Unsubscribe from all event listeners by calling each unsubscribe function
        this.eventListeners.forEach(unsubscribe => {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        });
        
        // Clear the event listeners array
        this.eventListeners = [];
        
        // Also properly unbind DOM events
        this.unbindEvents();
    }

    handleTransactionEvents(event) {
        console.log(`[${this.instanceId}] handleTransactionEvents called with:`, {
            type: event?.type,
            hasError: !!event?.error,
            hasHash: !!event?.hash,
            eventId: event?.id || 'none',
            handled: event?.handled || false
        });
        
        // Skip if this event has already been handled by this instance
        if (event?.handledBy?.includes(this.instanceId)) {
            console.log(`[${this.instanceId}] Event already handled by this instance, skipping`);
            return;
        }
        
        // Mark this event as handled by this instance
        if (!event.handledBy) {
            event.handledBy = [];
        }
        event.handledBy.push(this.instanceId);
        
        const direction = this.state.direction === 'buy' ? 'Buy' : 'Sell';

        // Check if this is a transaction event
        if (!event || !event.type) {
            console.warn('Invalid transaction event:', event);
            return;
        }

        // For transaction events - only show if it's not an error
        if ((event.type === 'buy' || event.type === 'sell' || event.type === 'swap') && !event.error) {
            console.log(`[${this.instanceId}] Showing transaction pending message for type:`, event.type);
            this.messagePopup.info(
                `${direction} transaction. Simulating...`,
                'Transaction Pending'
            );
        }

        // For confirmed transactions
        if (event.hash) {
            this.messagePopup.info(
                `Transaction confirmed, waiting for completion...`,
                'Transaction Confirmed'
            );
        }

        // For successful transactions
        if (event.receipt && (event.type === 'buy' || event.type === 'sell' || event.type === 'swap')) {
            const amount = this.state.direction === 'buy' 
                ? this.state.execAmount + ' EXEC'
                : this.state.ethAmount + ' ETH';
                
            this.messagePopup.success(
                `Successfully ${direction.toLowerCase() === 'buy' ? 'bought' : 'sold'} ${amount}`,
                'Transaction Complete'
            );

            // Clear inputs after successful transaction
            this.setState({
                ethAmount: '',
                execAmount: '',
                calculatingAmount: false
            });

            // Re-mount child components after state update
            const optionsContainer = this.element.querySelector('.transaction-options-container');
            const priceContainer = this.element.querySelector('.price-display-container');
            
            if (optionsContainer) {
                this.transactionOptions.mount(optionsContainer);
            }
            
            if (priceContainer) {
                this.priceDisplay.mount(priceContainer);
            }
        }

        // For error transactions
        if (event.error && !event.handled) {
            console.log(`[${this.instanceId}] Handling error in handleTransactionEvents:`, event.error);
            
            let errorMessage = event.error?.message || 'Transaction failed';
            
            if (errorMessage.includes('Contract call')) {
                const parts = errorMessage.split(': ');
                errorMessage = parts[parts.length - 1];
            }
            
            const context = this.state.direction === 'buy' ? 
                'Buy Failed' : 
                'Sell Failed';
            
            this.messagePopup.error(
                `${context}: ${errorMessage}`,
                'Transaction Failed'
            );

            event.handled = true;
        }
    }

    handleTransactionOptionsUpdate(options) {
        this.transactionOptionsState = {
            message: options.message,
            nftMintingEnabled: options.nftMintingEnabled
        };
    }

    handleInput(inputType, value) {
        // Clear any existing timer
        if (this.calculateTimer) {
            clearTimeout(this.calculateTimer);
        }

        // Update state immediately to show we're calculating
        this.state.activeInput = inputType;
        if (this.state.direction === 'buy') {
            if (inputType === 'top') {
                this.state.ethAmount = value;
            } else {
                this.state.execAmount = value;
            }
        } else {
            if (inputType === 'top') {
                this.state.execAmount = value;
            } else {
                this.state.ethAmount = value;
            }
        }
        this.state.calculatingAmount = true;
        this.updateElements();

        // Set debounced calculation
        this.calculateTimer = setTimeout(async () => {
            try {
                const isEthInput = (this.state.direction === 'buy') === (inputType === 'top');
                const calculatedAmount = await this.calculateSwapAmount(value, isEthInput ? 'eth' : 'exec');
                
                // Update the opposite input after calculation
                if (isEthInput) {
                    this.state.execAmount = calculatedAmount;
                } else {
                    this.state.ethAmount = calculatedAmount;
                }
                this.state.calculatingAmount = false;
                this.updateElements();
            } catch (error) {
                console.error('Error calculating swap amount:', error);
                this.state.calculatingAmount = false;
                this.updateElements();
            }
        }, 750);
    }

    events() {
        return {
            'input .top-input': (e) => this.handleInput('top', e.target.value),
            'input .bottom-input': (e) => this.handleInput('bottom', e.target.value),
            'click .direction-switch': (e) => this.handleDirectionSwitch(e),
            'click .swap-button': (e) => this.handleSwap(),
            'click [data-amount]': (e) => this.handleQuickFill(e),
            'click [data-percentage]': (e) => this.handleQuickFill(e)
        };
    }

    handleDirectionSwitch(e) {
        // Prevent default button behavior and stop propagation
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        
        // Clear any pending calculations
        if (this.calculateTimer) {
            clearTimeout(this.calculateTimer);
        }

        const newDirection = this.state.direction === 'buy' ? 'sell' : 'buy';
        

        console.log('Direction Switch - Current State:', {
            direction: this.state.direction,
            newDirection,
            freeMint: this.state.freeMint,
            freeSupply: this.state.freeSupply
        });

        // Store current values but DON'T swap them
        // Just change the direction
        this.state = {
            ...this.state,
            direction: newDirection,
            calculatingAmount: false,
            activeInput: null
        };

        this.store.setDirection(newDirection === 'buy');

        console.log('Direction Switch - Updated State:', {
            direction: this.state.direction,
            freeMint: this.state.freeMint,
            freeSupply: this.state.freeSupply
        });

        // Unbind events before updating content
        this.unbindEvents();
        
        // Force full re-render
        const newContent = this.render();
        this.element.innerHTML = newContent;
        
        // Re-mount both transaction options and price display
        const optionsContainer = this.element.querySelector('.transaction-options-container');
        const priceContainer = this.element.querySelector('.price-display-container');
        
        if (optionsContainer) {
            this.transactionOptions.mount(optionsContainer);
        }
        
        if (priceContainer) {
            this.priceDisplay.mount(priceContainer);
        }
        
        // Rebind events
        this.bindEvents();
    }

    isLiquidityDeployed() {
        const contractData = this.store.selectContractData();
        const result = contractData.liquidityPool && 
                      contractData.liquidityPool !== '0x0000000000000000000000000000000000000000';
        console.log('isLiquidityDeployed check:', {
            liquidityPool: contractData.liquidityPool,
            result: result
        });
        return result;
    }

    async handleSwap() {
        try {
            // Validate inputs
            if (this.state.calculatingAmount) {
                this.messagePopup.info('Please wait for the calculation to complete', 'Loading');
                return;
            }
            
            const { ethAmount, execAmount, direction } = this.state;
            
            if (!ethAmount || !execAmount || parseFloat(ethAmount) <= 0 || parseFloat(execAmount) <= 0) {
                this.messagePopup.info('Please enter valid amounts', 'Invalid Input');
                return;
            }
            
            // Check if user has enough balance
            const balances = this.store.selectBalances();
            
            if (direction === 'buy') {
                const ethBalance = parseFloat(balances.eth);
                const ethNeeded = parseFloat(ethAmount);
                
                if (ethNeeded > ethBalance) {
                    this.messagePopup.info('Not enough ETH balance', 'Insufficient Balance');
                    return;
                }
            } else {
                // Format amountIn with 18 decimals for BigNumber
                const execBalance = this.blockchainService.formatExec(balances.exec);
                const execNeeded = parseFloat(execAmount.replace(/,/g, ''));
                
                if (execNeeded > execBalance) {
                    this.messagePopup.info('Not enough EXEC balance', 'Insufficient Balance');
                    return;
                }
            }

            // Check if a free mint token is being sold
            if (direction === 'sell' && parseInt(execAmount.replace(/,/g, '')) <= 1000000 && this.state.freeMint) {
                this.messagePopup.info(
                    'Free minted tokens cannot be sold directly. Please trade more tokens or use a different address.', 
                    'Free Mint Restriction'
                );
                return;
            }
            
            const isLiquidityDeployed = this.isLiquidityDeployed();
            console.log('isLiquidityDeployed', isLiquidityDeployed);
            const cleanExecAmount = this.state.execAmount.replace(/,/g, '');

            if (isLiquidityDeployed) {
                const ethValue = this.blockchainService.parseEther(this.state.ethAmount);
                const execAmount = this.blockchainService.parseExec(cleanExecAmount);
                
                // Make sure we have the address resolved
                const address = await this.getAddress();
                
                // Check if we have a valid address
                if (!address) {
                    console.error('No wallet address available for transaction');
                    this.messagePopup.error(
                        'No wallet address available. Please reconnect your wallet.',
                        'Wallet Error'
                    );
                    return;
                }
                
                console.log(`Using address for transaction: ${address}`);

                if (this.state.direction === 'buy') {
                    // For buying, don't specify an expected output amount - this will be calculated in the service
                    await this.blockchainService.swapExactEthForTokenSupportingFeeOnTransfer(address, {
                        amount: execAmount, // Pass the full amount - it will be adjusted in the service
                    }, ethValue);
                } else {
                    // Check router allowance before selling
                    console.log(`