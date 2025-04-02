import {Component} from '../../core/Component.js';
import { tradingStore } from '../../store/tradingStore.js';
import { eventBus } from '../../core/EventBus.js';
import priceService from '../../services/PriceService.js';
import { layoutService, LAYOUT_EVENTS } from '../../services/LayoutService.js';
import SwapInterface from '../SwapInterface/SwapInterface.js';

import BondingCurve from '../BondingCurve/BondingCurve.js';

import PortfolioModal from '../PortfolioModal/PortfolioModal.js';

// Add event name constants at the top of the file
const EVENTS = {
    INPUT: {
        ETH_AMOUNT: 'trading:input:ethAmount',
        EXEC_AMOUNT: 'trading:input:execAmount',
        MESSAGE: 'trading:input:message'
    },
    CLICK: {
        QUICK_FILL: 'trading:click:quickFill',
        SWAP: 'trading:click:swap',
        SWAP_BUTTON: 'trading:click:swapButton',
        TAB: 'trading:click:tab'
    },
    CHANGE: {
        MESSAGE_OPTION: 'trading:change:messageOption',
        MINT_OPTION: 'trading:change:mintOption'
    },
    VIEW: {
        CHANGE: 'trading:view:change',
        RESIZE: 'trading:view:resize'
    }
};

export class TradingInterface extends Component {
    constructor(address, blockchainService, ethers, walletConnection) {
        super();
        const {walletAddress, isConnected, networkId} = walletConnection;
        tradingStore.setWalletAddress(walletAddress);
        tradingStore.setWalletConnected(isConnected);
        tradingStore.setWalletNetworkId(networkId);
        
        // Validate required parameters
        if (!blockchainService) throw new Error('BlockchainService is required');
        if (!address) throw new Error('Address is required');
        if (!ethers) throw new Error('Ethers is required');

        // Store instance variables
        this.address = address;
        this.blockchainService = blockchainService;
        this.ethers = ethers;
        this.walletConnection = walletConnection;
        this.currentWhitelistTier = null;
        this.showNotAllowedOverlay = false;
        
        // Initialize services
        priceService.initialize(blockchainService);

        // Initialize child components
        this.bondingCurve = new BondingCurve();
        this.swapInterface = new SwapInterface(blockchainService);
        
        // Single source of truth for layout state
        this.layoutState = {
            isMobile: layoutService.getState().isMobile,
            activeView: 'swap',
            visibleViews: layoutService.getState().isMobile ? ['swap'] : ['swap', 'curve']
        };

        // Initialize store with layout state
        tradingStore.setState({
            view: {
                isMobile: this.layoutState.isMobile,
                showCurve: !this.layoutState.isMobile,
                showSwap: true,
                current: this.layoutState.activeView
            }
        });
        
        tradingStore.updateBalances({
            eth: '0',
            exec: '0',
            nfts: '0'
        });
        
        tradingStore.updatePrice(0);
        tradingStore.updateAmounts('0', '0');
        
        // Call async initialization after constructor
        this.initialize();

        // Bind methods that will be used as callbacks
        this.handleStoreUpdate = this.handleStoreUpdate.bind(this);
        this.handleTradeExecuted = this.handleTradeExecuted.bind(this);
        this.handleWalletConnected = this.handleWalletConnected.bind(this);
        this.handlePriceUpdate = this.handlePriceUpdate.bind(this);
        this.handleLayoutChange = this.handleLayoutChange.bind(this);
        this.handleViewChange = this.handleViewChange.bind(this);
        this.handleTabClick = this.handleTabClick.bind(this);

        // Add portfolio handling
        this.handlePortfolioOpen = this.handlePortfolioOpen.bind(this);
        this.handlePortfolioClose = this.handlePortfolioClose.bind(this);
    }

    async initialize() {
        try {
            // Fetch initial balances and price concurrently
            const [ethAmount, execAmount, nfts, currentPrice, freeSituation, currentTier] = await Promise.all([
                this.blockchainService.getEthBalance(this.address),
                this.blockchainService.getTokenBalance(this.address),
                this.blockchainService.getNFTBalance(this.address),
                this.blockchainService.getCurrentPrice(),
                this.blockchainService.getFreeSituation(this.address),
                this.blockchainService.getCurrentTier()
            ]);

            const proof = await this.blockchainService.getMerkleProof(this.address, currentTier);
            if(!proof) {
                this.showNotAllowedOverlay = true;
                this.currentWhitelistTier = currentTier;
                
                // Update the tier text directly
                const tierText = this.element.querySelector('.tier-text');
                if (tierText) {
                    tierText.innerHTML = `Current Whitelist: Tier ${this.currentWhitelistTier}`;
                }
                
                // Add click handler when showing overlay
                const overlay = this.element.querySelector('.not-allowed-overlay');
                if (overlay) {
                    overlay.addEventListener('click', () => {
                        this.hideOverlay();
                    });
                }
                return;
            }

            // If we have a valid proof, make sure overlay is hidden
            this.showNotAllowedOverlay = false;
            const overlay = this.element.querySelector('.not-allowed-overlay');
            if (overlay) {
                overlay.style.display = 'none';
            }

            // Update store with fetched balances
            tradingStore.updateBalances({
                eth: ethAmount,
                exec: execAmount,
                nfts: nfts,
                lastUpdated: Date.now()
            });

            tradingStore.updateFreeSituation(freeSituation);

            // Update store with fetched price
            tradingStore.updatePrice(currentPrice);

            // Set up event listeners
            this.setupEventListeners();

        } catch (error) {
            console.error('Error in initialize:', error);
            const tierText = this.element.querySelector('.tier-text');
            if (tierText) {
                tierText.innerHTML = 'Current Whitelist: Tier ?';
            }
            this.currentWhitelistTier = '?'; // Set a fallback value if there's an error
            this.render(); // Re-render on error too
        }
    }

    setupEventListeners() {
        // Listen for events that affect balances or price
        this.unsubscribeHandlers = [
            eventBus.on('transaction:confirmed', async () => {
                await Promise.all([
                    this.updateBalances(),
                    this.updatePrice()
                ]);
            }),
            
            eventBus.on('account:changed', async () => {
                await Promise.all([
                    this.updateBalances(),
                    this.updatePrice()
                ]);
            }),

            eventBus.on('network:changed', async () => {
                await Promise.all([
                    this.updateBalances(),
                    this.updatePrice()
                ]);
            })
        ];
    }

    async updatePrice() {
        try {
            const currentPrice = await this.blockchainService.getCurrentPrice();
            tradingStore.updatePrice(currentPrice);
        } catch (error) {
            console.error('Error updating price:', error);
        }
    }

    async updateBalances() {
        try {
            const [ethAmount, execAmount, nfts] = await Promise.all([
                this.blockchainService.getEthBalance(this.address),
                this.blockchainService.getTokenBalance(this.address),
                this.blockchainService.getNFTBalance(this.address)
            ]);

            tradingStore.updateBalances({
                eth: ethAmount,
                exec: execAmount,
                nfts: nfts,
                lastUpdated: Date.now()
            });
        } catch (error) {
            console.error('Error updating balances:', error);
        }
    }

    cleanup() {
        if (this.unsubscribeHandlers) {
            this.unsubscribeHandlers.forEach(unsubscribe => unsubscribe());
        }
    }

    mount(container) {
        if (this.mounted) return;
        
        super.mount(container);

        // Initialize layout service first
        layoutService.initialize();
        
        // Setup event listeners
        eventBus.on(LAYOUT_EVENTS.VIEW_CHANGE, this.handleViewChange);
        eventBus.on(LAYOUT_EVENTS.RESIZE, this.handleLayoutChange);
        eventBus.on('portfolio:open', this.handlePortfolioOpen);
        eventBus.on('portfolio:close', this.handlePortfolioClose);

        // Setup tab click listeners
        this.setupTabListeners();
        
        // Setup portfolio button
        this.setupPortfolioButton();

        // Mount child components based on visibility
        this.mountChildComponents();
    }

    mountChildComponents() {
        const showCurve = this.shouldShowComponent('curve');
        const showSwap = this.shouldShowComponent('swap');

        // console.log('Mounting components:', {
        //     layoutState: this.layoutState,
        //     showCurve,
        //     showSwap,
        //     swapExists: !!this.swapInterface,
        //     curveExists: !!this.bondingCurve,
        //     containers: {
        //         swap: !!this.element.querySelector('#swap-container'),
        //         curve: !!this.element.querySelector('#curve-container')
        //     }
        // });

        // Initialize components if they don't exist
        if (!this.bondingCurve) {
            //console.log('Creating new bonding curve');
            this.bondingCurve = new BondingCurve();
        }
        if (!this.swapInterface) {
            //console.log('Creating new swap interface');
            this.swapInterface = new SwapInterface(this.blockchainService);
        }

        if (showCurve) {
            const curveContainer = this.element.querySelector('#curve-container');
            if (curveContainer) {
                //console.log('Mounting curve with current trading store state:', tradingStore.getState());
                this.bondingCurve.mount(curveContainer);
            } else {
                //console.warn('Curve container not found');
            }
        } else {
            //console.log('Unmounting curve');
            this.bondingCurve?.unmount();
        }

        if (showSwap) {
            const swapContainer = this.element.querySelector('#swap-container');
            if (swapContainer) {
                console.log('Mounting swap with current trading store state:', tradingStore.getState());
                this.swapInterface.mount(swapContainer);
            } else {
                console.warn('Swap container not found');
            }
        } else {
            console.log('Unmounting swap');
            this.swapInterface?.unmount();
        }

        this.mounted = true;
    }

    unmount() {
        if (!this.mounted) return;

        console.log('Unmounting trading interface components');
        
        // Unmount child components
        if (this.swapInterface) {
            console.log('Unmounting swap interface');
            this.swapInterface.unmount();
        }
        if (this.bondingCurve) {
            console.log('Unmounting bonding curve');
            this.bondingCurve.unmount();
        }

        // Remove tab click listeners
        const tabButtons = this.element.querySelectorAll('.tab-button');
        tabButtons.forEach(button => {
            button.removeEventListener('click', this.handleTabClick);
        });

        // Cleanup event listeners
        eventBus.off(LAYOUT_EVENTS.VIEW_CHANGE, this.handleViewChange);
        eventBus.off(LAYOUT_EVENTS.RESIZE, this.handleLayoutChange);

        // Clear all subscriptions and timers
        if (this.unsubscribeStore) {
            this.unsubscribeStore();
            this.unsubscribeStore = null;
        }

        if (this.eventBusSubscriptions) {
            this.eventBusSubscriptions.forEach(unsubscribe => unsubscribe());
            this.eventBusSubscriptions = null;
        }

        // Clean up DOM event listeners
        if (this.domCleanupFunctions) {
            this.domCleanupFunctions.forEach(cleanup => cleanup());
            this.domCleanupFunctions = null;
        }

        // Remove click handler
        if (this.documentClickHandler) {
            this.element.removeEventListener('click', this.documentClickHandler);
            this.documentClickHandler = null;
        }

        // Clear intervals and timeouts
        if (this.priceUpdateInterval) {
            clearInterval(this.priceUpdateInterval);
            this.priceUpdateInterval = null;
        }

        if (this.messageDebounce) {
            clearTimeout(this.messageDebounce);
            this.messageDebounce = null;
        }

        // Remove portfolio event listeners
        eventBus.off('portfolio:open', this.handlePortfolioOpen);
        eventBus.off('portfolio:close', this.handlePortfolioClose);

        // Call parent unmount last
        super.unmount();
    }

    handleStoreUpdate(state) {
        if (this.mounted) {
            requestAnimationFrame(() => {
                this.update();
            });
        }
    }

    handleTradeExecuted(tradeData) {
        console.log('Trade executed:', tradeData);
        this.loadBalances();
    }

    handleWalletConnected(walletAddress) {
        this.loadBalances();
    }

    handlePriceUpdate(data) {
        if (typeof data?.price === 'number' && !isNaN(data.price)) {
            tradingStore.setState({ 
                price: {
                    current: data.price,
                    lastUpdated: Date.now()
                }
            });
            
            if (this.mounted) {
                requestAnimationFrame(() => {
                    this.bondingCurve.initializeCurveChart();
                });
            }
        } else {
            console.warn('Invalid price data received:', data);
        }
    }

    handleLayoutChange(layoutState) {
        console.log('Layout Change:', {
            previous: this.layoutState,
            new: layoutState
        });

        // Update layout state
        this.layoutState = {
            ...this.layoutState,
            isMobile: layoutState.isMobile,
            visibleViews: layoutState.isMobile ? 
                [this.layoutState.activeView] : 
                ['swap', 'curve']
        };

        // Update store to match
        tradingStore.setState({
            view: {
                isMobile: this.layoutState.isMobile,
                showCurve: this.shouldShowComponent('curve'),
                showSwap: this.shouldShowComponent('swap'),
                current: this.layoutState.activeView
            }
        });

        // Force remount of components
        this.mountChildComponents();
    }

    handleViewChange(viewState) {
        console.log('View Change:', {
            previous: this.layoutState,
            new: viewState
        });

        // Skip if this is a response to our own tab click
        if (viewState.activeTab === this.layoutState.activeView) {
            console.log('View change matches current state, skipping update');
            return;
        }

        // Update layout state
        this.layoutState = {
            ...this.layoutState,
            activeView: viewState.activeTab,
            visibleViews: this.layoutState.isMobile ? 
                [viewState.activeTab] : 
                viewState.visibleViews
        };

        // Update store and UI
        this.batchUpdate(() => {
            tradingStore.setState({
                view: {
                    isMobile: this.layoutState.isMobile,
                    showCurve: this.shouldShowComponent('curve'),
                    showSwap: this.shouldShowComponent('swap'),
                    current: this.layoutState.activeView
                }
            });

            this.render();
            this.mountChildComponents();
        });
    }

    handlePortfolioClick() {
        console.log('Portfolio click handler triggered');
        eventBus.emit('portfolio:open');
    }

    handlePortfolioOpen() {
        console.log('Portfolio open handler triggered');
        const modalContainer = document.createElement('div');
        modalContainer.id = 'portfolio-modal-container';
        document.body.appendChild(modalContainer);
        
        this.portfolioModal = new PortfolioModal(this.blockchainService);
        this.portfolioModal.mount(modalContainer);
    }

    handlePortfolioClose() {
        console.log('Portfolio close handler triggered');
        const container = document.getElementById('portfolio-modal-container');
        if (container) {
            container.remove();
        }
        this.portfolioModal = null;
    }

    batchUpdate(updateFn) {
        if (this._batchTimeout) {
            clearTimeout(this._batchTimeout);
        }

        this._batchTimeout = setTimeout(() => {
            updateFn();
            this._batchTimeout = null;
        }, 0);
    }

    setupDOMEventListeners() {
        if (!this.element) {
            console.error('Element not found for DOM event setup');
            return;
        }

        // Create a single delegated click handler for all button interactions
        const handleClick = (e) => {
            // Quick fill button handling
            const quickFillButton = e.target.closest('.quick-fill');
            if (quickFillButton) {
                const value = quickFillButton.dataset.value;
                const isEthFill = quickFillButton.classList.contains('eth-fill');
                
                // Prevent double-firing of events
                e.preventDefault();
                e.stopPropagation();
                
                eventBus.emit(EVENTS.CLICK.QUICK_FILL, {
                    value,
                    isEthFill,
                    target: quickFillButton
                });
                return;
            }

            // Swap direction button
            const swapButton = e.target.closest('.swap-arrow-button');
            if (swapButton) {
                eventBus.emit(EVENTS.CLICK.SWAP);
                return;
            }

            // Main swap/trade button
            const mainSwapButton = e.target.closest('#swapButton');
            if (mainSwapButton) {
                eventBus.emit(EVENTS.CLICK.SWAP_BUTTON);
                return;
            }

            // Tab buttons
            const tabButton = e.target.closest('.tab-button');
            if (tabButton) {
                eventBus.emit(EVENTS.CLICK.TAB, {
                    view: tabButton.dataset.view
                });
                return;
            }
        };

        // Input event handlers with debouncing
        const createDebouncedHandler = (eventName, delay = 300) => {
            let timeout;
            return (e) => {
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    eventBus.emit(eventName, {
                        value: e.target.value,
                        target: e.target
                    });
                }, delay);
            };
        };

        // Setup input handlers
        const inputHandlers = {
            '#ethAmount': createDebouncedHandler(EVENTS.INPUT.ETH_AMOUNT),
            '#execAmount': createDebouncedHandler(EVENTS.INPUT.EXEC_AMOUNT),
            '#transactionMessage': createDebouncedHandler(EVENTS.INPUT.MESSAGE, 1000)
        };

        // Setup change handlers
        const changeHandlers = {
            '#leaveMessage': (e) => eventBus.emit(EVENTS.CHANGE.MESSAGE_OPTION, {
                checked: e.target.checked
            }),
            '#mintNFT': (e) => eventBus.emit(EVENTS.CHANGE.MINT_OPTION, {
                checked: e.target.checked
            })
        };

        // Store cleanup functions
        this.domCleanupFunctions = [];

        // Add click handler
        this.element.addEventListener('click', handleClick);
        this.domCleanupFunctions.push(() => 
            this.element.removeEventListener('click', handleClick)
        );

        // Add input handlers
        Object.entries(inputHandlers).forEach(([selector, handler]) => {
            const element = this.element.querySelector(selector);
            if (element) {
                element.addEventListener('input', handler);
                this.domCleanupFunctions.push(() => 
                    element.removeEventListener('input', handler)
                );
            }
        });

        // Add change handlers
        Object.entries(changeHandlers).forEach(([selector, handler]) => {
            const element = this.element.querySelector(selector);
            if (element) {
                element.addEventListener('change', handler);
                this.domCleanupFunctions.push(() => 
                    element.removeEventListener('change', handler)
                );
            }
        });

        if (this.debugMode) {
            console.log('DOM event listeners setup complete');
        }
    }

    handleSwapButton(e) {
        const state = tradingStore.getState();
        if (state.isEthToExec) {
            this.handleBuyExec();
        } else {
            this.handleSellExec();
        }
    }

    handleMessageChange(e) {
        tradingStore.setState({
            showMessageOption: e.checked
        });
    }

    handleMessageInput(e) {
        if (this.messageDebounce) {
            clearTimeout(this.messageDebounce);
        }
        const value = e.target.value;
        this.messageDebounce = setTimeout(() => {
            tradingStore.setState({ 
                transactionMessage: value,
                messageDebounceActive: false 
            });
        }, 3000);
        
        // Set immediate visual feedback
        tradingStore.setState({ 
            messageDebounceActive: true,
            pendingMessage: value 
        });
    }

    handleMintChange(e) {
        tradingStore.setState({
            mintOptionChecked: e.checked
        });
    }

    handleEthInput(e) {
        tradingStore.setState({
            ethAmount: e.value,
            execAmount: ''
        });
    }

    handleExecInput(e) {
        tradingStore.setState({
            execAmount: e.value,
            ethAmount: ''
        });
    }

    handleQuickFill(e) {
        const { value, isEthFill } = e;
        
        if (isEthFill) {
            tradingStore.setState({
                ethAmount: value,
                execAmount: ''
            });
        } else {
            const { exec: execBalance } = tradingStore.selectBalances();
            const percent = parseInt(value);
            const amount = (execBalance * (percent / 100)).toFixed(2);
            
            tradingStore.setState({
                execAmount: amount,
                ethAmount: ''
            });
        }
    }

    handleSwap() {
        const state = tradingStore.getState();
        tradingStore.setState({
            isEthToExec: !state.isEthToExec,
            ethAmount: state.execAmount,
            execAmount: state.ethAmount
        });
    }

    async loadBalances() {
        try {
            if (!this.blockchainService) {
                throw new Error('BlockchainService not initialized');
            }
            
            const tokenBalance = await this.blockchainService.getTokenBalance(this.address);
            const nftBalance = await this.blockchainService.getNFTBalance(this.address);
            const ethBalance = await this.blockchainService.getEthBalance(this.address);
            
            tradingStore.updateBalances({
                eth: parseFloat(this.ethers.utils.formatEther(ethBalance)),
                exec: parseInt(tokenBalance),
                nfts: nftBalance
            });
        } catch (error) {
            console.error('Error loading balances:', {
                error,
                blockchainService: this.blockchainService,
                address: this.address
            });
            throw error;
        }
    }

    async updatePrice() {
        try {
            const price = await priceService.getCurrentPrice();
            tradingStore.setState({ currentPrice: price });
        } catch (error) {
            console.error('Error updating price:', error);
        }
    }

    handleTabClick(event) {
        const view = event.target.dataset.view;
        console.log('Tab Click:', {
            view,
            previousState: this.layoutState,
            element: event.target
        });

        if (view === this.layoutState.activeView) {
            console.log('Tab already active, skipping update');
            return;
        }

        // Update layout state
        this.layoutState = {
            ...this.layoutState,
            activeView: view,
            visibleViews: this.layoutState.isMobile ? [view] : ['swap', 'curve']
        };

        // Batch our updates to prevent multiple renders
        this.batchUpdate(() => {
            // Update store
            tradingStore.setState({
                view: {
                    isMobile: this.layoutState.isMobile,
                    showCurve: this.shouldShowComponent('curve'),
                    showSwap: this.shouldShowComponent('swap'),
                    current: view
                }
            });

            // Notify layout service
            eventBus.emit(LAYOUT_EVENTS.VIEW_CHANGE, {
                activeTab: view,
                visibleViews: this.layoutState.visibleViews
            });

            // Update UI
            this.render();
            this.mountChildComponents();
            
            // Re-setup portfolio button after render
            this.setupPortfolioButton();
        });
    }

    setupTabListeners() {
        console.log('Setting up tab listeners');
        const tabButtons = this.element.querySelectorAll('.tab-button');
        tabButtons.forEach(button => {
            button.removeEventListener('click', this.handleTabClick);
            button.addEventListener('click', this.handleTabClick.bind(this));
            console.log('Added listener to button:', button.dataset.view);
        });
    }

    async handleBuyExec() {
        const state = tradingStore.getState();
        if (!state.isEthToExec) {
            console.error('Sell functionality not yet implemented');
            return;
        }

        try {
            // Validate inputs
            const amount = parseFloat(state.execAmount);
            const ethValue = parseFloat(state.ethAmount);
            
            if (isNaN(amount) || isNaN(ethValue) || amount <= 0 || ethValue <= 0) {
                throw new Error('Invalid input amounts');
            }

            // Convert amounts to contract format
            const execAmount = BigInt(Math.floor(amount)).toString();
            const maxCost = BigInt(Math.floor(ethValue * 1e18)).toString();
            
            // Get merkle proof from blockchain service
            const proof = await this.blockchainService.getMerkleProof(this.address);
            
            const params = {
                amount: execAmount,
                maxCost: maxCost,
                mintNFT: state.mintOptionChecked || false,
                proof: proof,
                message: state.transactionMessage || ''
            };

            // Send transaction using BlockchainService
            const receipt = await this.blockchainService.buyBonding(params, ethValue);

            console.log('Transaction confirmed:', receipt);
            eventBus.emit('trade:executed', { type: 'buy', receipt });
            
            // Refresh balances and price
            await this.loadBalances();
            await this.updatePrice();

            // Clear inputs
            tradingStore.setState({
                ethAmount: '',
                execAmount: '',
                transactionMessage: '',
                showMessageOption: false,
                mintOptionChecked: false
            });

        } catch (error) {
            console.error('Transaction failed:', error);
            eventBus.emit('transaction:error', error);
        }
    }

    async handleSellExec() {
        const state = tradingStore.getState();
        if (state.isEthToExec) {
            console.error('Buy functionality should use handleBuyExec');
            return;
        }

        try {
            // Validate inputs
            const amount = parseFloat(state.execAmount);
            const minEthReturn = parseFloat(state.ethAmount);
            
            if (isNaN(amount) || isNaN(minEthReturn) || amount <= 0 || minEthReturn <= 0) {
                throw new Error('Invalid input amounts');
            }

            // Check if sale would break NFT requirements
            const warning = this.checkNFTBalanceWarning();
            if (warning) {
                throw new Error(warning.message);
            }

            // Convert amounts to contract format
            const execAmount = BigInt(Math.floor(amount)).toString();
            const minReturn = BigInt(Math.floor(minEthReturn * 1e18)).toString();
            
            // Get merkle proof from blockchain service
            const proof = await this.blockchainService.getMerkleProof(this.address);
            
            const params = {
                amount: execAmount,
                minReturn: minReturn,
                proof: proof,
                message: state.transactionMessage || ''
            };

            // Send transaction using BlockchainService
            const receipt = await this.blockchainService.sellBonding(params);

            console.log('Transaction confirmed:', receipt);
            eventBus.emit('trade:executed', { type: 'sell', receipt });
            
            // Refresh balances and price
            await this.loadBalances();
            await this.updatePrice();

            // Clear inputs
            tradingStore.setState({
                ethAmount: '',
                execAmount: '',
                transactionMessage: '',
                showMessageOption: false
            });

        } catch (error) {
            console.error('Transaction failed:', error);
            eventBus.emit('transaction:error', error);
        }
    }

    checkNFTBalanceWarning() {
        const { isEthToExec } = tradingStore.selectDirection();
        const { exec: execAmount } = tradingStore.selectAmounts();
        const { exec: execBalance, nfts } = tradingStore.selectBalances();

        // Only check for warnings when selling EXEC and user has NFTs
        if (isEthToExec || nfts === 0) return null;

        const amount = parseFloat(execAmount || 0);
        const remainingBalance = execBalance - amount;
        const requiredBalance = nfts * 1000000;

        if (remainingBalance < requiredBalance) {
            return {
                type: 'error',
                message: `Warning: This sale would reduce your balance below ${nfts}M EXEC required to support your NFTs. Please reduce the sale amount or burn NFTs first.`
            };
        }

        return null;
    }

    shouldShowMintOption() {
        const { isEthToExec } = tradingStore.selectDirection();
        const { exec: execAmount } = tradingStore.selectAmounts();
        const { exec: execBalance, nfts } = tradingStore.selectBalances();

        // Only show mint option for ETH to EXEC transactions
        if (!isEthToExec) return false;

        const amount = parseFloat(execAmount || 0);
        
        // If user has no NFTs, check if total balance would be enough
        if (nfts === 0) {
            const totalExec = execBalance + amount;
            return totalExec >= 1000000;
        }
        
        // If user has NFTs, they need a full 1M new EXEC to mint another
        return amount >= 1000000;
    }

    async updatePreciseExecAmount(ethValue) {
        try {
            // Convert ETH to wei
            const weiValue = this.ethers.utils.parseEther(ethValue.toString());
            
            // Get the current price from price service
            const price = await priceService.getCurrentPrice();
            
            // Calculate approximate EXEC amount based on current price
            const execAmount = (ethValue * (1000000 / parseFloat(price))).toFixed(2);
            
            // Update the state with the more precise amount
            tradingStore.setState({
                execAmount: execAmount
            });

            // Update the curve chart to reflect new position
            if (this.mounted) {
                requestAnimationFrame(() => {
                    this.bondingCurve.initializeCurveChart();
                });
            }
        } catch (error) {
            console.error('Error calculating precise EXEC amount:', error);
            // Keep the current estimate if precise calculation fails
        }
    }

    shouldShowComponent(view) {
        // Only use layoutState for decisions
        if (this.layoutState.isMobile) {
            return view === this.layoutState.activeView;
        }
        return this.layoutState.visibleViews.includes(view);
    }

    render() {
        const { isMobile, activeView } = this.layoutState;
        
        // Cache visibility results
        const showCurve = this.shouldShowComponent('curve');
        const showSwap = this.shouldShowComponent('swap');
        
        console.log('Rendering trading interface', {
            isMobile,
            activeView,
            shouldShowCurve: showCurve,
            shouldShowSwap: showSwap
        });
        
        const html = `
            <div class="trading-interface ${isMobile ? 'mobile' : ''}">
                ${isMobile ? `
                    <div class="tab-navigation">
                        <button class="tab-button ${activeView === 'curve' ? 'active' : ''}" 
                                data-view="curve">
                            Bonding Curve
                        </button>
                        <button class="tab-button ${activeView === 'swap' ? 'active' : ''}" 
                                data-view="swap">
                            Swap
                        </button>
                        <button class="portfolio-button">
                            Portfolio
                        </button>
                    </div>
                ` : `<div class="tab-navigation">
                        <button class="portfolio-button">
                            Portfolio
                        </button>
                    </div>`
                 }

                <div class="trading-container">
                    <div v-if="showNotAllowedOverlay" class="not-allowed-overlay" @click="hideOverlay">
                        <img src="/public/stop.png" alt="Not Allowed" />
                        <div class="overlay-text">NOT ALLOW</div>
                        <div class="tier-text">Current Whitelist: Tier ${this.currentWhitelistTier !== null ? this.currentWhitelistTier : 'Loading...'}</div>
                    </div>
                    <div id="curve-container" 
                         class="view-container ${activeView === 'curve' ? 'active' : ''}"
                         style="display: ${showCurve ? 'block' : 'none'}">
                    </div>
                    
                    <div id="swap-container" 
                         class="view-container ${activeView === 'swap' ? 'active' : ''}"
                         style="display: ${showSwap ? 'block' : 'none'}">
                    </div>
                </div>
            </div>
        `;

        if (this.element) {
            this.element.innerHTML = html;
            this.setupTabListeners();
        }

        return html;
    }

    static get styles() {
        return `
            .trading-interface {
                display: flex;
                flex-direction: column;
                gap: 20px;
                height: 100%;
            }

            .trading-interface.mobile {
                flex-direction: column;
            }

            .view-container {
                flex: 1;
                min-height: 0;  /* Important for flex containers */
            }

            .view-container.active {
                display: flex;
            }

            .tab-navigation {
                display: flex;
                gap: 10px;
                margin-bottom: 20px;
            }

            .portfolio-button {
                padding: 8px 16px;
                border-radius: 4px;
                color: white;
                background-color: #000000;
                border: 1px solid #fdb523;
                cursor: pointer;
                margin-left: auto;
            }

            .portfolio-button:hover {
                background-color: #e0e0e0;
            }

            .trading-interface-container {
                position: relative;
            }

            .not-allowed-overlay {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.8);
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                z-index: 1000;
            }

            .not-allowed-overlay img {
                max-width: 200px;
                margin-bottom: 20px;
            }

            .overlay-text {
                color: white;
                font-size: 32px;
                font-weight: bold;
                text-align: center;
            }

            .tier-text {
                color: white;
                font-size: 24px;
                margin-top: 10px;
                text-align: center;
                font-family: monospace;
            }
        `;
    }

    setupPortfolioButton() {
        const portfolioButton = this.element.querySelector('.portfolio-button');
        if (portfolioButton) {
            console.log('Setting up portfolio button');
            portfolioButton.addEventListener('click', this.handlePortfolioClick.bind(this));
        }
    }

    hideOverlay() {
        this.showNotAllowedOverlay = false;
        const overlay = this.element.querySelector('.not-allowed-overlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }
}

export default TradingInterface; 