let portalURL = (process.env.USE_UAT === 'true') ? 'https://agent-aotf-uat.corelogic.com/en-US/agent/login' :
    (process.env.USE_INT === 'true') ? 'https://agent-portal-int.kfusc1int.solutions.corelogic.com/en-US/agent/login'
        : 'http://agent.onehome.com/en-US/';


const credentials = {
    username: 'T/AMSARIKA',
    password: 'Agentportal1235'
}
const credentials1 = {
    username: 'T/AKDEEPIKA',
    password: 'AgentPortal1234'
}
const credentials2 = {
    username: 'T/SKODANDASAIRAM',
    password: 'AgentPortal1234'
}

const credentials3 = {
    username: "T/RECHANDRASEKARAN",
    password: "agent3892^",
};
const credentials4 = {
    username: "T/TUMPALA",
    password: "agent3255*",
};

let MLS_Values;
if (process.env.USE_UAT === 'true') {
    MLS_Values = "Carolina Multiple Listing Services, Inc. (CAROLINA)";

}
else if (process.env.USE_INT === 'true') {
    MLS_Values = "MLS Now (formerly NorthEast Ohio Real Estate EXchange and YES-MLS)";
}

const MLS_Values1 = "Information Technology Systems Ontario (ITSO)";
const MLS_Values2 ="CANOPY UAT - Canopy MLS (Charlotte, NC)"

module.exports = {
    portalURL,
    credentials,
    credentials1,
    credentials2,
    credentials3,
    credentials4,
    MLS_Values,
    MLS_Values1,
    MLS_Values2
}

