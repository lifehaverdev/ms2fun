const { MerkleTree } = window;
// import { ethers } from '/node_modules/ethers/dist/ethers.esm.js';
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';

// Wrapper function for Ethers.js hashing
const hashWithEthers = (input) => ethers.utils.solidityKeccak256(["address"], [input]);


class MerkleHandler {
    constructor() {
        this.trees = new Map(); // Store trees for different lists
    }

    // Initialize trees for all whitelist tiers
    async initializeTrees() {
        try {
            // Define the files in order of days
            const files = {
                '01': '01_cult_1.json',
                '02': '02_fumo.json',
                '03': '03_cult_2.json',
                '04': '04_remixbonkler.json',
                '05': '05_cult_4.json',
                '06': '06_monyms2.json',
                '07': '07_cult_8.json',
                '08': '08_kagamibanners.json',
                '09': '09_cult_15.json',
                '10': '10_milady.json',
                '11': '11_cult_29.json',
                '12': '12_cult_56.json'
            };
            
            for (const [day, filename] of Object.entries(files)) {
                const addresses = await this.loadAddresses(filename, day);
                if (addresses && addresses.length > 0) {
                    // Create and store tree for this day
                    this.createTree(day, addresses);
                }
            }
            
            console.log('Merkle trees initialized for all days');
        } catch (error) {
            console.error('Error initializing merkle trees:', error);
            throw error;
        }
    }

    // Load addresses for a specific file
    async loadAddresses(filename, day) {
        try {
            const response = await fetch(`/lists/${filename}`);
            if (!response.ok) {
                throw new Error(`Failed to load addresses for day ${day} (${filename})`);
            }
            const data = await response.json();
            return data.addresses;
        } catch (error) {
            console.error(`Error loading addresses for day ${day} (${filename}):`, error);
            return null;
        }
    }

    // Create merkle tree for a specific tier
    createTree(tier, addresses) {
        try {
            
            const leaves = addresses.map(addr => {
                const leaf = ethers.utils.solidityKeccak256(['address'], [addr]);
                return leaf;
            });

            // Create tree with solidityKeccak256 hash function
            const tree = new MerkleTree(leaves, hashWithEthers, {
                sortPairs: true
            });

            console.log(`Merkle tree created for day ${tier}: ${tree.getHexRoot()}`);

            // Store tree for later use
            this.trees.set(tier, {
                tree,
                addresses,
                root: tree.getHexRoot()
            });

            return tree;
        } catch (error) {
            console.error(`Error creating merkle tree for tier ${tier}:`, error);
            throw error;
        }
    }

    // Get merkle proof for an address in a specific tier
    getProof(tier, address) {
        try {
            const paddedTier = tier.toString().padStart(2, '0');  // Convert 2 to '02'
            const treeData = this.trees.get(paddedTier);
            if (!treeData) {
                throw new Error(`No tree found for tier ${tier}`);
            }

            // Hash the address directly without type specification
            //const leaf = ethers.utils.keccak256(address);  // Changed from solidityKeccak256(['address'], [address])
            const leaf = ethers.utils.solidityKeccak256(['address'], [address]);
            
            // Get proof from tree
            const proof = treeData.tree.getHexProof(leaf);
            
            return {
                proof,
                root: treeData.root,
                valid: treeData.tree.verify(proof, leaf, treeData.root)
            };
        } catch (error) {
            console.error(`Error getting proof for address ${address} in tier ${tier}:`, error);
            return null;
        }
    }

    // Get merkle root for a specific tier
    getRoot(tier) {
        try {
            const paddedTier = tier.toString().padStart(2, '0');  // Convert 2 to '02'
            const treeData = this.trees.get(paddedTier);
            if (!treeData) {
                throw new Error(`No tree found for tier ${tier}`);
            }
            return treeData.root;
        } catch (error) {
            console.error(`Error getting root for tier ${tier}:`, error);
            return null;
        }
    }

    // Verify if an address is in a specific tier
    verifyAddress(tier, address) {
        try {
            const paddedTier = tier.toString().padStart(2, '0');  // Convert 2 to '02'
            const treeData = this.trees.get(paddedTier);
            if (!treeData) {
                return false;
            }

            // Hash the address directly without type specification
            //const leaf = ethers.utils.keccak256(address);  // Changed from solidityKeccak256(['address'], [address])
            const leaf = ethers.utils.solidityKeccak256(['address'], [address]);
            
            // Get and verify proof
            const proof = treeData.tree.getHexProof(leaf);
            return treeData.tree.verify(proof, leaf, treeData.root);
        } catch (error) {
            console.error(`Error verifying address ${address} in tier ${tier}:`, error);
            return false;
        }
    }

    // Find which tier an address belongs to
    findAddressTier(address) {
        for (const [tier, treeData] of this.trees.entries()) {
            if (this.verifyAddress(tier, address)) {
                return tier;
            }
        }
        return null;
    }
}

export default MerkleHandler;