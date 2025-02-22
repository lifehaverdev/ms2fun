import WalletModal from './src/components/WalletModal/WalletModal.js';
import StatusMessage from './src/components/StatusMessage/StatusMessage.js';
import TradingInterface from './src/components/TradingInterface/TradingInterface.js';
import ChatPanel from './src/components/ChatPanel/ChatPanel.js';
import { ethers } from './node_modules/ethers/dist/ethers.esm.js';
import ContractHandler from './contractHandler.js';
import { eventBus } from './src/eventBus.js';

console.log('Ethers imported:', ethers);

class Web3Handler {
    constructor() {
        this.contractData = null;
        this.web3 = null;
        this.contract = null;
        this.connected = false;
        this.selectedWallet = null;
        this.connectedAddress = null;
        this.contractHandler = null;
        
        this.statusMessage = new StatusMessage('contractStatus');
        
        console.log('Web3Handler initialized');
        this.statusMessages = {
            INITIALIZING: 'INITIALIZING SYSTEM...',
            CONTRACT_FOUND: 'SECURE SYSTEM READY',
            WALLET_DETECTED: 'WALLET DETECTED. CLICK CONNECT TO PROCEED.',
            CONNECTING: 'REQUESTING SECURE CONNECTION...',
            CONNECTED: 'CONNECTION ESTABLISHED',
            ERROR: 'ERROR: ',
            SELECT_WALLET: 'SELECT YOUR WALLET',
            WALLET_SELECTED: 'WALLET SELECTED: ',
            VERIFYING_WHITELIST: 'VERIFYING WHITELIST STATUS...',
            SIGN_REQUIRED: 'SIGNATURE REQUIRED TO PROCEED',
            SIGN_PENDING: 'AWAITING SIGNATURE...',
            VERIFIED: 'VERIFICATION COMPLETE - INITIALIZING INTERFACE'
        };
        this.providerMap = {
            rabby: () => window.rabby || window.ethereum,
            rainbow: () => window.rainbow || window.ethereum,
            phantom: () => window.phantom?.ethereum,
            metamask: () => window.metamask?.ethereum || window.ethereum,
            // metamask: () => {
            //     // MetaMask specific detection
            //     const provider = window.ethereum;
            //     if (provider?.isMetaMask && !provider.isRabby) {
            //         return provider;
            //     }
            //     return null;
            // },
            walletconnect: () => null // Will implement later with WalletConnect v2
        };
        
        // Add wallet icons mapping
        this.walletIcons = {
            rabby: '/public/wallets/rabby.webp',
            rainbow: '/public/wallets/rainbow.webp',
            phantom: '/public/wallets/phantom.webp',
            metamask: '/public/wallets/metamask.webp',
            walletconnect: '/public/wallets/walletconnect.webp'
        };

        this.walletModal = new WalletModal(
            this.providerMap, 
            this.walletIcons,
            (walletType) => this.handleWalletSelection(walletType)  // Pass callback
        );
        this.chatPanel = new ChatPanel();
    }

    async init() {
        console.log('Starting Web3Handler init...');
        try {
            console.log('Attempting to load switch.json from EXEC404 directory...');
            const response = await fetch('/EXEC404/switch.json');
            console.log('Response:', response);
            
            if (!response.ok) {
                this.statusMessage.update('System offline', true);
                return false;
            }
            
            this.contractData = await response.json();
            console.log('Contract data loaded:', this.contractData);
            
            // Replace system status panel with chat panel
            const statsPanel = document.querySelector('.stats-panel');
            if (statsPanel) {
                const chatInterface = document.createElement('div');
                chatInterface.className = 'chat-panel';
                chatInterface.innerHTML = `
                    <div class="chat-header">
                        <h2>EXEC INSIDER BULLETIN</h2>
                    </div>
                    <div class="chat-messages" id="chatMessages">
                        <!-- Messages will be populated here -->
                    </div>
                    <div class="chat-status">
                        <span>MESSAGES LOADED FROM CHAIN</span>
                        <span class="message-count">0</span>
                    </div>
                `;
                statsPanel.parentNode.replaceChild(chatInterface, statsPanel);
                
                // Initialize chat messages
                await this.chatPanel.loadMessages();
            }
            
            // Check if wallet is available but don't connect yet
            if (typeof window.ethereum !== 'undefined') {
                this.statusMessage.update(this.statusMessages.WALLET_DETECTED);
            } else {
                this.statusMessage.update('Please install MetaMask or another Web3 wallet');
            }
            
            // Hide GIF container when contract is found
            const gifContainer = document.querySelector('.gif-container');
            if (gifContainer) {
                gifContainer.style.display = 'none';
            }
            
            this.setupWalletSelection();
            this.setupBottomSectionCollapse();
            
            return true;
        } catch (error) {
            console.error('Error in init:', error);
            this.statusMessage.update(this.statusMessages.ERROR + error.message, true);
            return false;
        }
    }

    setupWalletSelection() {
        const selectWalletBtn = document.getElementById('selectWallet');
        
        selectWalletBtn.addEventListener('click', () => {
            this.walletModal.show();
            this.statusMessage.update(this.statusMessages.SELECT_WALLET);
        });
    }

    async handleWalletSelection(walletType) {
        console.log('Wallet selected:', walletType);
        this.selectedWallet = walletType;
        
        try {
            const provider = this.providerMap[walletType]();
            console.log('Raw provider obtained:', provider);
            
            if (!provider) {
                throw new Error(`${walletType} not detected`);
            }

            // Check and enforce network settings
            const targetNetwork = this.contractData.network;
            const targetRpcUrl = this.contractData.rpcUrl;
            
            // Get current network
            const currentNetwork = await provider.request({ method: 'eth_chainId' });
            console.log('Current network:', currentNetwork);
            
            // If network doesn't match, try to switch
            if (currentNetwork !== `0x${Number(targetNetwork).toString(16)}`) {
                try {
                    await provider.request({
                        method: 'wallet_switchEthereumChain',
                        params: [{ chainId: `0x${Number(targetNetwork).toString(16)}` }],
                    });
                } catch (switchError) {
                    // If the network doesn't exist, add it
                    if (switchError.code === 4902) {
                        await provider.request({
                            method: 'wallet_addEthereumChain',
                            params: [{
                                chainId: `0x${Number(targetNetwork).toString(16)}`,
                                rpcUrls: [targetRpcUrl],
                                chainName: 'Local Test Network',
                                nativeCurrency: {
                                    name: 'ETH',
                                    symbol: 'ETH',
                                    decimals: 18
                                }
                            }]
                        });
                    } else {
                        throw switchError;
                    }
                }
            }

            // Store the provider for future use
            this.provider = provider;

            // Initialize ContractHandler with provider and contract address
            console.log('Initializing ContractHandler with address:', this.contractData.address);
            console.log('Provider state before ContractHandler:', {
                isConnected: provider.connected,
                chainId: provider.chainId,
                selectedAddress: provider.selectedAddress
            });

            this.contractHandler = new ContractHandler(
                provider,
                this.contractData.address
            );

            // Wait for initialization
            await this.contractHandler.initialize();
            console.log('ContractHandler initialized:', this.contractHandler);

            // Update the selected wallet display
            this.walletModal.updateSelectedWalletDisplay(walletType);

            // Some providers (like Rabby) need to be explicitly activated
            if (walletType === 'rabby' && provider.activate) {
                await provider.activate();
            }

            this.statusMessage.update(this.statusMessages.WALLET_SELECTED + walletType.toUpperCase());
            await this.connectWallet();

        } catch (error) {
            console.error('Error in handleWalletSelection:', error);
            this.statusMessage.update(`${error.message}. Please install ${walletType}.`, true);
            throw error;
        }
    }

    async connectWallet() {
        if (!this.selectedWallet || !this.provider) {
            throw new Error('Please select a wallet first');
        }

        this.statusMessage.update(this.statusMessages.CONNECTING);
        
        try {
            console.log('Requesting wallet connection...');
            await new Promise(resolve => setTimeout(resolve, 500));
            
            let accounts;
            switch (this.selectedWallet) {
                case 'phantom':
                    accounts = await window.phantom.ethereum.request({
                        method: 'eth_requestAccounts'
                    });
                    break;
                    
                default:
                    accounts = await this.provider.request({
                        method: 'eth_requestAccounts',
                        params: []
                    });
            }
            
            console.log('Got accounts:', accounts);
            
            if (accounts && accounts[0]) {
                console.log('Setting up connection with address:', accounts[0]);
                this.connected = true;
                this.connectedAddress = accounts[0];
                
                await new Promise(resolve => setTimeout(resolve, 500));
                
                console.log('Removing wallet UI elements...');
                // Remove the wallet selection display completely
                this.walletModal.hideWalletDisplay();
                
                console.log('Showing trading interface...');
                // Skip verification and show trading interface directly
                await this.showTradingInterface();
                
                // Emit wallet connected event
                eventBus.emit('wallet:connected', this.connectedAddress);
                
                return this.connectedAddress;
            } else {
                throw new Error('No accounts found');
            }
        } catch (error) {
            console.error('Connection error:', error);
            // Show select button again on error
            this.walletModal.showSelectButton();
            
            if (error.code === 4001) {
                this.statusMessage.update('Connection request declined. Please try again.', true);
            } else {
                this.statusMessage.update(this.statusMessages.ERROR + error.message, true);
            }
            throw error;
        }
    }

    async verifyWhitelist(address) {
        this.statusMessage.update(this.statusMessages.VERIFYING_WHITELIST);
        
        try {
            const response = await fetch(`/api/whitelist/${address}`);
            const data = await response.json();
            
            if (!data.isWhitelisted) {
                throw new Error('Address not whitelisted');
            }

            // Request signature
            await this.requestSignature(address);
            
            // If we get here, show the trading interface
            this.showTradingInterface();
            
        } catch (error) {
            this.statusMessage.update('Whitelist verification failed: ' + error.message, true);
            throw error;
        }
    }

    async requestSignature(address) {
        this.statusMessage.update(this.statusMessages.SIGN_REQUIRED);
        
        const message = `CULT EXECS Whitelist Verification\nAddress: ${address}\nTimestamp: ${Date.now()}`;
        
        try {
            this.statusMessage.update(this.statusMessages.SIGN_PENDING);
            const signature = await this.provider.request({
                method: 'personal_sign',
                params: [message, address]
            });
            
            // Verify signature server-side if needed
            // await this.verifySignature(signature, address, message);
            
            this.statusMessage.update(this.statusMessages.VERIFIED);
        } catch (error) {
            this.statusMessage.update('Signature failed: ' + error.message, true);
            throw error;
        }
    }

    async showTradingInterface() {
        if (!this.connectedAddress) {
            throw new Error('No connected address found');
        }

        const currentPrice = await this.getCurrentPrice();
        
        // Remove the original status message element
        const originalStatus = document.getElementById('contractStatus');
        if (originalStatus) {
            originalStatus.remove();
        }

        // Create and render trading interface
        const tradingInterface = new TradingInterface(this.connectedAddress, this.contractHandler, ethers);
        const tradingElement = tradingInterface.render();

        // Add to DOM
        const bondingInterface = document.getElementById('bondingCurveInterface');
        bondingInterface.innerHTML = '';
        bondingInterface.appendChild(tradingElement);
        bondingInterface.style.display = 'block';
        bondingInterface.classList.add('active');
        
        // Initialize the curve chart
        requestAnimationFrame(() => {
            this.initializeCurveChart(currentPrice);
        });

        // Setup mobile tabbing if needed
        if (window.innerWidth <= 768) {
            tradingInterface.setupMobileTabbing();
        }

        // Update panels
        await this.updateInterfacePanels();
    }

    async updateInterfacePanels() {
        // Restore system status panel
        const chatPanel = document.querySelector('.chat-panel');
        if (chatPanel) {
            const statsPanel = this.chatPanel.render('stats');
            statsPanel.className = 'panel stats-panel';
            chatPanel.parentNode.replaceChild(statsPanel, chatPanel);
        }

        // Replace the checker panel with the chat interface
        const checkerPanel = document.querySelector('.checker-panel');
        if (checkerPanel) {
            const chatInterface = this.chatPanel.render('bulletin');
            checkerPanel.parentNode.replaceChild(chatInterface, checkerPanel);
        }

        // Update the tabs active state
        document.querySelector('#whitelistTab')?.classList.remove('active');
        document.querySelector('#presaleTab')?.classList.add('active');

        // Initialize the chat messages
        await this.chatPanel.loadMessages();
    }

    async getCurrentPrice() {
        try {
            if (!this.contractHandler) {
                throw new Error('Contract handler not initialized');
            }
            const price = await this.contractHandler.getCurrentPrice();
            // Use ethers.utils.formatEther instead of ethers.formatEther
            return price.eth/10;
        } catch (error) {
            console.error('Error in getCurrentPrice:', error);
            throw error;
        }
    }

    async initializeCurveChart(currentPrice) {
        const canvas = document.getElementById('curveChart');
        const ctx = canvas.getContext('2d');
        
        // Set canvas size
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Set styles
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 2;
        
        // Modified curve function with even more dramatic curve
        const curve = (x) => {
            // Add padding of 10% at bottom and top
            const paddedX = 0.1 + (x * 0.8);
            return Math.pow(paddedX, 3.5); // Increased from 2.5 to 3.5 for steeper curve
        }
        
        // Calculate the maximum price point for scaling
        const maxPrice = curve(1);
        
        // Adjust position calculation to account for padding
        const currentPosition = Math.max(0.1, Math.min(0.9, Math.pow(currentPrice / maxPrice, 1/3.5))); // Match the curve power
        
        // Draw main curve
        ctx.beginPath();
        const startX = canvas.width * 0.1;
        const startY = canvas.height * 0.9;
        ctx.moveTo(startX, startY);
        
        const points = 100;
        const curvePoints = []; // Store points for later use
        
        // First populate all curve points
        for (let i = 0; i <= points; i++) {
            const x = i / points;
            const y = curve(x);
            
            const canvasX = x * canvas.width * 0.8 + canvas.width * 0.1;
            const canvasY = canvas.height * 0.9 - y * canvas.height * 0.8;
            
            curvePoints.push({ x: canvasX, y: canvasY });
        }
        
        // Now draw the main curve using the points
        ctx.beginPath();
        ctx.moveTo(curvePoints[0].x, curvePoints[0].y);
        for (let i = 0; i < curvePoints.length; i++) {
            ctx.lineTo(curvePoints[i].x, curvePoints[i].y);
        }
        ctx.stroke();
        
        // Update position indicator code
        const segmentSize = 0.05; // Reduced size for more precise indication
        
        // Ensure position stays within bounds
        const boundedPosition = Math.max(0, Math.min(0.99, currentPosition));
        
        // Calculate indices for highlighted segment
        const startIndex = Math.max(0, Math.min(points - 1, Math.floor((boundedPosition - segmentSize/2) * points)));
        const endIndex = Math.max(0, Math.min(points - 1, Math.floor((boundedPosition + segmentSize/2) * points)));
        
        if (startIndex < curvePoints.length && endIndex < curvePoints.length) {
            // Draw highlighted segment
            ctx.beginPath();
            ctx.strokeStyle = '#FFD700';
            ctx.lineWidth = 4; // Slightly thicker
            
            // Start slightly before the current position
            ctx.moveTo(curvePoints[startIndex].x, curvePoints[startIndex].y);
            
            // Draw the highlighted segment
            for (let i = startIndex; i <= endIndex && i < curvePoints.length; i++) {
                ctx.lineTo(curvePoints[i].x, curvePoints[i].y);
            }
            
            ctx.stroke();
            
            // Draw the indicator dot at the center of the highlighted segment
            const centerIndex = Math.floor((startIndex + endIndex) / 2);
            if (centerIndex < curvePoints.length) {
                const centerPoint = curvePoints[centerIndex];
                
                ctx.beginPath();
                ctx.arc(centerPoint.x, centerPoint.y, 4, 0, Math.PI * 2);
                ctx.fillStyle = '#FF0000';
                ctx.fill();
            }
        }
        
        // Add labels with dimmer color
        ctx.fillStyle = '#666666';
        ctx.font = '12px Courier New';
        ctx.fillText(`${currentPrice.toFixed(4)} ETH / CULT EXECUTIVE COLLECTIBLE`, 10, 20); // Price in top left
        //ctx.fillText('', canvas.width - 70, canvas.height - 10); // $EXEC label at bottom
    }

    setupBottomSectionCollapse() {
        const toggleBar = document.createElement('div');
        toggleBar.className = 'bottom-section-toggle';
        toggleBar.innerHTML = `
            <span class="toggle-arrow">↑</span>
            <span class="toggle-text">SHOW INFO</span>
        `;

        const colorBar = document.querySelector('.color-bar');
        const mainContent = document.querySelector('.main-content');
        
        // Insert toggle bar before color bar
        colorBar.parentNode.insertBefore(toggleBar, colorBar);
        
        // Set initial state on mobile
        if (window.innerWidth <= 768) {
            mainContent.classList.add('collapsed');
            toggleBar.querySelector('.toggle-arrow').textContent = '↑';
            toggleBar.querySelector('.toggle-text').textContent = 'SHOW INFO';
        }

        // Add click handler
        toggleBar.addEventListener('click', () => {
            mainContent.classList.toggle('collapsed');
            const isCollapsed = mainContent.classList.contains('collapsed');
            toggleBar.querySelector('.toggle-arrow').textContent = isCollapsed ? '↑' : '↓';
            toggleBar.querySelector('.toggle-text').textContent = isCollapsed ? 'SHOW INFO' : 'HIDE INFO';
        });
    }
}

function initializeSwapInterface() {
    // Wait for DOM elements to exist
    const ethAmount = document.getElementById('ethAmount');
    const execAmount = document.getElementById('execAmount');
    const swapArrowButton = document.querySelector('.swap-arrow-button');
    const swapButton = document.getElementById('swapButton');
    
    // Check if required elements exist
    if (!ethAmount || !execAmount || !swapArrowButton || !swapButton) {
        console.log('Swap interface elements not found, skipping initialization');
        return;
    }

    const ethFillButtons = document.querySelectorAll('.eth-fill');
    const execFillButtons = document.querySelectorAll('.exec-fill');
    let isEthToExec = true;

    swapArrowButton.innerHTML = '<span class="arrow">↓</span>';

    // Set initial focus
    ethAmount.focus();

    // Handle quick fill buttons
    ethFillButtons.forEach(button => {
        button.addEventListener('click', () => {
            ethAmount.value = button.dataset.value;
            updateExecAmount(); // You'll need to implement this based on your conversion rate
        });
    });

    execFillButtons.forEach(button => {
        button.addEventListener('click', () => {
            const percentage = parseInt(button.dataset.value);
            // Implement max balance calculation here
            execAmount.value = (maxBalance * percentage / 100).toFixed(6);
            updateEthAmount(); // You'll need to implement this based on your conversion rate
        });
    });

    // Handle swap button
    swapArrowButton.addEventListener('click', () => {
        isEthToExec = !isEthToExec; // Toggle direction
        swapArrowButton.classList.toggle('flipped');

        // Swap input values
        const tempValue = ethAmount.value;
        ethAmount.value = execAmount.value;
        execAmount.value = tempValue;

        // Swap IDs
        const tempId = ethAmount.id;
        ethAmount.id = execAmount.id;
        execAmount.id = tempId;

        // Swap labels
        const labels = document.querySelectorAll('.currency-label');
        const tempLabel = labels[0].textContent;
        labels[0].textContent = labels[1].textContent;
        labels[1].textContent = tempLabel;

        // Toggle quick fill buttons
        document.querySelectorAll('.eth-fill').forEach(btn => btn.classList.toggle('hidden'));
        document.querySelectorAll('.exec-fill').forEach(btn => btn.classList.toggle('hidden'));

        // Update swap button text
        swapButton.textContent = isEthToExec ? 'BUY EXEC' : 'SELL EXEC';

        // Focus the top input
        document.querySelector('.input-group input').focus();
    });

    // Update the swap button text when values change
    ethAmount.addEventListener('input', () => {
        swapButton.textContent = isEthToExec ? 'BUY EXEC' : 'SELL EXEC';
    });

    execAmount.addEventListener('input', () => {
        swapButton.textContent = isEthToExec ? 'BUY EXEC' : 'SELL EXEC';
    });
}

// Call this function after your DOM is loaded
document.addEventListener('DOMContentLoaded', initializeSwapInterface); 
export default Web3Handler; 

async function executeTrade(tradeDetails) {
    // ... existing trade execution code ...
    
    // Emit trade executed event
    eventBus.emit('trade:executed', {
        address: tradeDetails.address,
        amount: tradeDetails.amount,
        timestamp: Date.now()
    });
} 