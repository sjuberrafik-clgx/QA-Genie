/**
 * Custom Workflow Templates
 * User-configurable workflow templates for flexible automation pipelines
 * 
 * @module CustomTemplates
 * @version 1.0.0
 */

const fs = require('fs');
const path = require('path');

const CUSTOM_TEMPLATES_FILE = path.join(__dirname, 'custom-templates.json');

/**
 * Default stage definitions with validation rules
 */
const StageDefinitions = {
    PENDING: {
        name: 'Pending',
        description: 'Workflow initialized, waiting to start',
        agent: 'orchestrator',
        action: 'initialize',
        timeout: 60000,  // 1 minute
        validation: null,
        prerequisites: []
    },
    JIRA_FETCHED: {
        name: 'Jira Fetched',
        description: 'Jira ticket details retrieved',
        agent: 'testgenie',
        action: 'fetch_jira',
        timeout: 60000,
        validation: 'validateJiraData',
        prerequisites: ['PENDING']
    },
    TESTCASES_GENERATED: {
        name: 'Test Cases Generated',
        description: 'Manual test cases created from requirements',
        agent: 'testgenie',
        action: 'generate_testcases',
        timeout: 120000,  // 2 minutes
        validation: 'validateTestCases',
        prerequisites: ['JIRA_FETCHED']
    },
    EXCEL_CREATED: {
        name: 'Excel Created',
        description: 'Test cases exported to Excel file',
        agent: 'testgenie',
        action: 'create_excel',
        timeout: 60000,
        validation: 'validateExcel',
        prerequisites: ['TESTCASES_GENERATED']
    },
    SCRIPT_EXPLORATION: {
        name: 'App Exploration',
        description: 'Live application exploration with Playwright MCP',
        agent: 'scriptgenerator',
        action: 'explore_app',
        timeout: 300000,  // 5 minutes
        validation: 'validateExploration',
        prerequisites: ['EXCEL_CREATED']
    },
    SCRIPT_GENERATED: {
        name: 'Script Generated',
        description: 'Playwright test script created',
        agent: 'scriptgenerator',
        action: 'generate_script',
        timeout: 180000,  // 3 minutes
        validation: 'validateScript',
        prerequisites: ['SCRIPT_EXPLORATION']
    },
    SCRIPT_EXECUTED: {
        name: 'Script Executed',
        description: 'Test script executed with results',
        agent: 'scriptgenerator',
        action: 'execute_test',
        timeout: 600000,  // 10 minutes
        validation: 'validateExecution',
        prerequisites: ['SCRIPT_GENERATED']
    },
    BUG_REPORTED: {
        name: 'Bug Reported',
        description: 'Bug ticket created in Jira',
        agent: 'buggenie',
        action: 'create_bug',
        timeout: 120000,
        validation: 'validateBugTicket',
        prerequisites: []
    },
    COMPLETED: {
        name: 'Completed',
        description: 'Workflow completed successfully',
        agent: 'orchestrator',
        action: 'finalize',
        timeout: 60000,
        validation: null,
        prerequisites: []
    }
};

/**
 * Rollback strategies
 */
const RollbackStrategies = {
    PRESERVE_ALL: {
        name: 'Preserve All',
        description: 'Keep all generated artifacts',
        keepArtifacts: ['test-cases/*.xlsx', 'tests/**/*.spec.js'],
        cleanupOnFailure: []
    },
    PRESERVE_TESTCASES: {
        name: 'Preserve Test Cases',
        description: 'Keep test cases, cleanup scripts on failure',
        keepArtifacts: ['test-cases/*.xlsx'],
        cleanupOnFailure: ['tests/**/*-generated.spec.js', 'test-results/*']
    },
    CLEANUP_ALL: {
        name: 'Cleanup All',
        description: 'Remove all artifacts on failure',
        keepArtifacts: [],
        cleanupOnFailure: ['test-cases/*.xlsx', 'tests/**/*-generated.spec.js', 'test-results/*']
    },
    CUSTOM: {
        name: 'Custom',
        description: 'User-defined artifact handling',
        keepArtifacts: [],
        cleanupOnFailure: []
    }
};

/**
 * Template Builder Class
 */
class TemplateBuilder {
    constructor(name) {
        this.template = {
            name: name,
            description: '',
            version: '1.0.0',
            author: 'custom',
            createdAt: new Date().toISOString(),
            stages: [],
            rollbackStrategy: RollbackStrategies.PRESERVE_TESTCASES,
            options: {
                parallel: false,
                maxRetries: 3,
                continueOnError: false,
                notifications: {
                    onStart: false,
                    onComplete: true,
                    onFailure: true
                }
            },
            variables: {}
        };
    }

    /**
     * Set template description
     */
    description(desc) {
        this.template.description = desc;
        return this;
    }

    /**
     * Add a stage to the workflow
     */
    addStage(stageName, customConfig = {}) {
        const baseStage = StageDefinitions[stageName];
        if (!baseStage) {
            throw new Error(`Unknown stage: ${stageName}. Available: ${Object.keys(StageDefinitions).join(', ')}`);
        }

        this.template.stages.push({
            stage: stageName,
            ...baseStage,
            ...customConfig
        });
        return this;
    }

    /**
     * Add custom stage not in StageDefinitions
     */
    addCustomStage(config) {
        const requiredFields = ['stage', 'name', 'agent', 'action'];
        for (const field of requiredFields) {
            if (!config[field]) {
                throw new Error(`Custom stage missing required field: ${field}`);
            }
        }

        this.template.stages.push({
            timeout: 120000,
            validation: null,
            prerequisites: [],
            ...config
        });
        return this;
    }

    /**
     * Set rollback strategy
     */
    rollback(strategyName, customConfig = {}) {
        const strategy = RollbackStrategies[strategyName];
        if (!strategy) {
            throw new Error(`Unknown strategy: ${strategyName}. Available: ${Object.keys(RollbackStrategies).join(', ')}`);
        }

        this.template.rollbackStrategy = { ...strategy, ...customConfig };
        return this;
    }

    /**
     * Configure options
     */
    options(opts) {
        this.template.options = { ...this.template.options, ...opts };
        return this;
    }

    /**
     * Define template variables
     */
    variables(vars) {
        this.template.variables = { ...this.template.variables, ...vars };
        return this;
    }

    /**
     * Build and validate the template
     */
    build() {
        // Validate template
        this.validate();
        return this.template;
    }

    /**
     * Validate template configuration
     */
    validate() {
        if (this.template.stages.length === 0) {
            throw new Error('Template must have at least one stage');
        }

        // Check PENDING and COMPLETED stages
        const stageNames = this.template.stages.map(s => s.stage);
        if (!stageNames.includes('PENDING')) {
            console.warn('Template should start with PENDING stage');
        }
        if (!stageNames.includes('COMPLETED')) {
            console.warn('Template should end with COMPLETED stage');
        }

        // Validate prerequisites
        for (const stage of this.template.stages) {
            for (const prereq of stage.prerequisites || []) {
                if (!stageNames.includes(prereq)) {
                    throw new Error(`Stage ${stage.stage} has unknown prerequisite: ${prereq}`);
                }
            }
        }
    }
}

/**
 * Custom Templates Manager
 */
class CustomTemplatesManager {
    constructor() {
        this.templates = this.loadTemplates();
    }

    /**
     * Load custom templates from disk
     */
    loadTemplates() {
        try {
            if (fs.existsSync(CUSTOM_TEMPLATES_FILE)) {
                return JSON.parse(fs.readFileSync(CUSTOM_TEMPLATES_FILE, 'utf8'));
            }
        } catch (error) {
            console.warn(`Failed to load custom templates: ${error.message}`);
        }
        return {};
    }

    /**
     * Save custom templates to disk
     */
    saveTemplates() {
        try {
            fs.writeFileSync(CUSTOM_TEMPLATES_FILE, JSON.stringify(this.templates, null, 2), 'utf8');
        } catch (error) {
            console.error(`Failed to save custom templates: ${error.message}`);
        }
    }

    /**
     * Create a new template builder
     */
    createBuilder(name) {
        return new TemplateBuilder(name);
    }

    /**
     * Register a custom template
     */
    register(templateId, template) {
        if (this.templates[templateId]) {
            console.warn(`Overwriting existing template: ${templateId}`);
        }

        this.templates[templateId] = {
            ...template,
            registeredAt: new Date().toISOString()
        };
        this.saveTemplates();

        return templateId;
    }

    /**
     * Get a template by ID
     */
    get(templateId) {
        return this.templates[templateId] || null;
    }

    /**
     * List all custom templates
     */
    list() {
        return Object.entries(this.templates).map(([id, template]) => ({
            id,
            name: template.name,
            description: template.description,
            stages: template.stages.length,
            createdAt: template.createdAt
        }));
    }

    /**
     * Delete a custom template
     */
    delete(templateId) {
        if (!this.templates[templateId]) {
            return false;
        }
        delete this.templates[templateId];
        this.saveTemplates();
        return true;
    }

    /**
     * Clone an existing template
     */
    clone(sourceId, newId, newName) {
        const source = this.templates[sourceId];
        if (!source) {
            throw new Error(`Template not found: ${sourceId}`);
        }

        const cloned = JSON.parse(JSON.stringify(source));
        cloned.name = newName;
        cloned.createdAt = new Date().toISOString();
        cloned.clonedFrom = sourceId;

        this.templates[newId] = cloned;
        this.saveTemplates();

        return newId;
    }

    /**
     * Export template to JSON file
     */
    export(templateId, outputPath) {
        const template = this.templates[templateId];
        if (!template) {
            throw new Error(`Template not found: ${templateId}`);
        }

        fs.writeFileSync(outputPath, JSON.stringify(template, null, 2), 'utf8');
        return outputPath;
    }

    /**
     * Import template from JSON file
     */
    import(templateId, inputPath) {
        const content = fs.readFileSync(inputPath, 'utf8');
        const template = JSON.parse(content);

        // Validate imported template
        if (!template.name || !template.stages) {
            throw new Error('Invalid template format: missing required fields');
        }

        this.templates[templateId] = {
            ...template,
            importedAt: new Date().toISOString(),
            importedFrom: inputPath
        };
        this.saveTemplates();

        return templateId;
    }
}

/**
 * Pre-built custom templates
 */
const PrebuiltTemplates = {
    /**
     * Quick test case generation (no automation)
     */
    'quick-testcases': new TemplateBuilder('Quick Test Cases')
        .description('Generate test cases only - fastest workflow for manual testing')
        .addStage('PENDING')
        .addStage('JIRA_FETCHED')
        .addStage('TESTCASES_GENERATED')
        .addStage('EXCEL_CREATED')
        .addStage('COMPLETED')
        .rollback('PRESERVE_ALL')
        .options({ maxRetries: 2 })
        .build(),

    /**
     * Full automation with bug reporting
     */
    'full-automation-with-bugs': new TemplateBuilder('Full Automation with Bug Reporting')
        .description('Complete workflow: test cases → automation → execution → bug reports on failure')
        .addStage('PENDING')
        .addStage('JIRA_FETCHED')
        .addStage('TESTCASES_GENERATED')
        .addStage('EXCEL_CREATED')
        .addStage('SCRIPT_EXPLORATION')
        .addStage('SCRIPT_GENERATED')
        .addStage('SCRIPT_EXECUTED')
        .addStage('BUG_REPORTED', {
            prerequisites: [], // Only runs on failure
            conditional: 'onFailure'
        })
        .addStage('COMPLETED')
        .rollback('PRESERVE_TESTCASES')
        .options({ maxRetries: 3, continueOnError: false })
        .build(),

    /**
     * Exploration only - no script generation
     */
    'exploration-only': new TemplateBuilder('Exploration Only')
        .description('Explore application and capture selectors without generating scripts')
        .addStage('PENDING')
        .addStage('JIRA_FETCHED')
        .addStage('TESTCASES_GENERATED')
        .addStage('EXCEL_CREATED')
        .addStage('SCRIPT_EXPLORATION')
        .addStage('COMPLETED')
        .rollback('PRESERVE_ALL')
        .options({ maxRetries: 2 })
        .build(),

    /**
     * Script generation from existing Excel
     */
    'excel-to-automation': new TemplateBuilder('Excel to Automation')
        .description('Generate automation from existing Excel test cases (skip Jira fetch)')
        .addStage('PENDING')
        .addCustomStage({
            stage: 'EXCEL_LOADED',
            name: 'Excel Loaded',
            description: 'Load existing Excel test cases',
            agent: 'scriptgenerator',
            action: 'load_excel',
            validation: 'validateExcel',
            prerequisites: ['PENDING']
        })
        .addStage('SCRIPT_EXPLORATION', { prerequisites: ['EXCEL_LOADED'] })
        .addStage('SCRIPT_GENERATED')
        .addStage('SCRIPT_EXECUTED')
        .addStage('COMPLETED')
        .rollback('PRESERVE_ALL')
        .variables({ excelPath: '' })  // User must provide
        .build(),

    /**
     * Regression suite generation
     */
    'regression-suite': new TemplateBuilder('Regression Suite')
        .description('Generate multiple test scripts from a batch of Jira tickets')
        .addStage('PENDING')
        .addCustomStage({
            stage: 'TICKETS_LOADED',
            name: 'Tickets Loaded',
            description: 'Load multiple Jira tickets for processing',
            agent: 'orchestrator',
            action: 'load_tickets',
            prerequisites: ['PENDING']
        })
        .addCustomStage({
            stage: 'BATCH_TESTCASES',
            name: 'Batch Test Cases',
            description: 'Generate test cases for all tickets',
            agent: 'testgenie',
            action: 'batch_generate',
            prerequisites: ['TICKETS_LOADED']
        })
        .addCustomStage({
            stage: 'BATCH_AUTOMATION',
            name: 'Batch Automation',
            description: 'Generate automation for all test cases',
            agent: 'scriptgenerator',
            action: 'batch_automate',
            prerequisites: ['BATCH_TESTCASES']
        })
        .addStage('COMPLETED')
        .rollback('PRESERVE_TESTCASES')
        .options({ parallel: true, maxRetries: 2 })
        .variables({ tickets: [] })  // Array of ticket IDs
        .build()
};

// Export for Node.js usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        TemplateBuilder,
        CustomTemplatesManager,
        StageDefinitions,
        RollbackStrategies,
        PrebuiltTemplates
    };
}
