'use strict';
var appRoot = require('app-root-path');
const fs = require('fs')
const jestPlugin = require('serverless-jest-plugin');
const moment = require('moment');
const JSON5 = require('json5');
let saveValue = new Object();
const excuted_timestamp = moment().valueOf();
function getValue(subject) {
    if (typeof subject != "string") {
        return subject;
    }
    let sign = subject.substring(0, 1);
    //커스텀 함수값
    if (subject == "$now") {
        return moment().valueOf();
    }
    else if (subject == "$excuted_timestamp") {
        return excuted_timestamp;
    }
    //이미 저장된 값
    else if (sign == "@") {
        let key = subject.substring(1);
        return saveValue[key];
    }
    else {
        return subject
    }
}
function replaceAll(str, find, replace) {
    return str.replace(new RegExp(find, 'g'), replace);
}
function excludeIterate(inputobject, delObject) {
    let newObject = inputobject;
    delObject.forEach((item, idx) => {
        if (!(item.value instanceof Object)) {
            if (newObject != undefined && newObject.hasOwnProperty(item.key)) {
                delete newObject[item.key];
            }
        }
        else {
            newObject[item.key] = excludeIterate(newObject[item.key], item.value)
        }
    })
    return newObject;
}
function iterate(obj) {
    if (!(obj instanceof Object)) {
        return getValue(obj);
    }
    for (var property in obj) {

        if (obj.hasOwnProperty(property)) {
            if (typeof obj[property] == "object") {
                obj[property] = iterate(obj[property]);
            } else {
                let val = obj[property];
                obj[property] = getValue(val);
            }
        }
    }
    return obj;
}
expect.extend({
    myGraphQLNotTobe(response, value) {
        const obj = JSON.parse(response.body);
        if (!obj.errors) {
            return {
                message: () =>
                    `expected error but no error`,
                pass: false,
            }
        }
        else {
            return {
                message: () => { return "ok" }, pass: true
            };
        }
    },
    myToBe(response, value) {
        const pass = response.statusCode == value;
        if (pass) {
            return {
                message: () =>
                    `expected ${response.statusCode} =  ${value}`,
                pass: true,
            };
        } else {
            return {
                message: () =>
                    `expected:${response.statusCode},received: ${value}, message:${(response.body)} `,
                pass: false,
            };
        }
    },
});

function generateGraphQLOutput(spec, str) {
    for (var property in spec) {
        let spect = spec[property];
        str += property;
        if (spect.sub) {
            str = generateGraphQLOutput(spect.sub, str + "{") + "}"
        }
        str += " "
    }
    return str;
}

function checkSaveValue(item, _responseObject, responseObject) {
    //나중에 사용하기 위해 값 저장
    if (item.saveValue) {
        item.saveValue.forEach((keyObject, index) => {
            if (keyObject instanceof Object) {
                const saveKey = keyObject.key;
                let sign = saveKey.substring(0, 1);
                if (sign == "@")//data가 아닌 값에서 가져오기
                {
                    const actualKey = saveKey.substring(1)
                    if (_responseObject && _responseObject.hasOwnProperty(actualKey)) {
                        saveValue[keyObject.saveas] = _responseObject[actualKey];
                    }
                }
                else {
                    if (responseObject && responseObject.hasOwnProperty(saveKey)) {
                        saveValue[keyObject.saveas] = responseObject[saveKey];
                    }
                }
            }
            else {
                const saveKey = keyObject;
                let sign = saveKey.substring(0, 1);

                if (sign == "@")//data가 아닌 값에서 가져오기
                {
                    const actualKey = saveKey.substring(1)
                    if (_responseObject && _responseObject.hasOwnProperty(actualKey)) {
                        saveValue[actualKey] = _responseObject[actualKey];
                    }
                }
                else {
                    if (responseObject && responseObject.hasOwnProperty(saveKey)) {
                        saveValue[saveKey] = responseObject[saveKey];
                    }
                }
            }
        })
    }
}
function initiateInput(input, testDirection, item) {
    input["testProfile"] = testDirection.aws_profile;
    input["app"] = testDirection.app;
    input["testing"] = true;
    input["description"] = item.description;
    input["stage"] = testDirection.stage;
    input["env"] = testDirection.env;
    if (item.token) {
        input["headers"] = { "Authorization": "Bearer " + getValue(item.token) }
    }
    if (item.env) {
        item.useCustomValue.forEach((env, index) => {
            input["env"].push(env)
        });

    }
    if (item.useCustomValue2) {
        item.useCustomValue2.forEach((customObject, index) => {
            let val = "";
            let key = "";
            for (var property in customObject) {
                key = property;
                val = iterate(customObject[property])

                if (input.body) {
                    let inputObject = JSON5.parse(input.body);

                    inputObject[key] = val;

                    input.body = JSON.stringify(inputObject);
                }
                if (input.queryStringParameters) {
                    input.queryStringParameters[key] = val;
                }
            }
        })
    }

    if (item.useCustomValue) {
        item.useCustomValue.forEach((customObject, index) => {
            let val = customObject;
            let key = customObject;
            if (customObject instanceof Object) {
                key = customObject.key;
                val = iterate(customObject.value)
            }
            else {
                key = key.substring(1);
                val = iterate(customObject)
            }
            if (input.body) {
                let inputObject = JSON5.parse(input.body);
                inputObject[key] = val;
                input.body = JSON.stringify(inputObject);
            }
            if (input.queryStringParameters) {
                input.queryStringParameters[key] = val;
            }
        })
    }
    if (item.excludeValue) {
        let inputObject = undefined;
        let newInputObject = undefined;
        if (input.body) {
            inputObject = JSON5.parse(input.body);

        }
        if (input.queryStringParameters) {
            inputObject = input.queryStringParameters;
        }
        newInputObject = excludeIterate(inputObject, item.excludeValue)
        if (input.body) {
            input.body = JSON.stringify(newInputObject);
        }
        if (input.queryStringParameters) {
            input.queryStringParameters = newInputObject
        }
    }
    return input;
}

//---

// describe('REST', () => {
//     beforeEach(() => {
//         jest.setTimeout(timeout);
//     });
//     test(testDirection,)
// });
// describe('graphql', () => {
//     beforeEach(() => {
//         jest.setTimeout(timeout);
//     });
//     test(testDirection, true)
// });

function test(useGraphql = false) {

    var text = fs.readFileSync('testInput/testInput.json', 'utf8')
    if (process.env.INPUTFILE && process.env.INPUTFILE != "NULL") {
        text = fs.readFileSync(`testInput/${process.env.INPUTFILE}.json`, 'utf8')
    }
    const testDirection = JSON5.parse(text);
    let timeout = 20000;
    if (testDirection.timeout) {
        timeout = testDirection.timeout;
    }
    testDirection.test_targets.forEach((item, index) => {
        if (item.skip) {
            return;
        }
        let apexMode = require(appRoot + "/src/lambda/" + item.uri);
        let apiSpec = apexMode.apiSpec;

        if (useGraphql && apiSpec.graphql) {
            const mod = require(appRoot + "/src/lambda/graphql");
            const lambdaWrapper = jestPlugin.lambdaWrapper;
            const wrapped = lambdaWrapper.wrap(mod, { handler: 'handler' });
            const apiPath = item.uri
            it(`${apiPath}(graphQL):${(item.description) ? " " + item.description : ""}`, async () => {
                let input = { queryStringParameters: {}, body: JSON.stringify({}) };
                try {
                    const path0 = fs.readFileSync("testInput/" + apiPath + ".json");
                    let inputTem = JSON5.parse(path0);
                    input.body = (inputTem.queryStringParameters) ? JSON.stringify(inputTem.queryStringParameters) : inputTem.body;
                }
                catch (e) {
                    console.log(e);
                }
                //initiadte input
                let inputObject = JSON5.parse(input.body);
                input.body = JSON.stringify(iterate(inputObject));
                input = initiateInput(input, testDirection, item);

                //create graphql
                let graphqlcommand = replaceAll(item.uri, "\\/", "_")
                const obj = JSON.parse(input.body);
                let str = "";
                for (var property in obj) {
                    str = str + `${property}:${Number.isInteger(obj[property]) ? obj[property] : `"${obj[property]}"`},`
                }
                str = str.substring(0, str.length - 1);
                let split = item.uri.split("/");
                let graphql = `${((item.qltype == "mutation" || (split[split.length - 1] != "get")) ? "mutation " : "")}{${graphqlcommand}`
                if (str != "") {
                    graphql = graphql + `(${str})`;
                }
                let outputs = generateGraphQLOutput(apiSpec.responses, "");
                graphql = graphql + "{" + outputs + "}}";

                input.body = JSON.stringify({ query: graphql });


                return wrapped.run(input).then(async (response) => {
                    console.log("\u001b[1;35m " + item.uri + ": result:" + JSON.stringify(response) + "\u001b[1;0m")
                    console.log("graphql:", graphql)
                    let responseObject
                    let _responseObject
                    if (item.not) {
                        responseObject = response;
                    }
                    else {
                        _responseObject = JSON5.parse(response.body);
                        if (!_responseObject.data) {
                            console.log("err");
                        }
                        responseObject = (item.type == "check_array_first_value") ? _responseObject.data[graphqlcommand].data[0] : _responseObject.data[graphqlcommand];
                        responseObject = responseObject.data;
                    }
                    checkSaveValue(item, _responseObject, responseObject)
                    try {
                        if (item.not) {
                            await expect(response).myGraphQLNotTobe(200);
                        } else {
                            await expect(_responseObject["errors"]).toBe(undefined);
                        }
                    }
                    catch (e) {
                        throw e;  // <= set your breakpoint here
                    }
                });
            });

        }
        else {
            const mod = require(appRoot + "/src/lambda/" + item.uri);
            const lambdaWrapper = jestPlugin.lambdaWrapper;
            const wrapped = lambdaWrapper.wrap(mod, { handler: 'handler' });
            it(item.uri + ((item.description) ? " " + item.description : ""), async () => {
                let uri = item.uri;
                if (item.testInputFile) {
                    uri = item.testInputFile;
                }
                let input = { queryStringParameters: {}, body: JSON.stringify({}) };
                try {
                    const path0 = fs.readFileSync("testInput/" + uri + ".json");
                    input = JSON5.parse(path0);
                }
                catch (e) {
                    console.log(e);
                }
                if (input.body) {
                    let inputObject = JSON5.parse(input.body);
                    input.body = JSON.stringify(iterate(inputObject));
                }
                if (input.queryStringParameters) {

                    if (!input.useRawValue) {
                        if (input.queryStringParameters instanceof Object) {
                            input.queryStringParameters = iterate(input.queryStringParameters);
                        }
                    }

                }
                input = initiateInput(input, testDirection, item);


                return wrapped.run(input).then(async (response) => {
                    console.log("\u001b[1;35m " + item.uri + ": result:" + JSON.stringify(response) + "\u001b[1;0m")
                    let responseObject
                    let _responseObject
                    _responseObject = (item.type == "check_wss_ok") ? response : JSON5.parse(response.body);
                    responseObject = (item.type == "check_array_first_value") ? _responseObject.data[0] : _responseObject.data;
                    //나중에 사용하기 위해 값 저장
                    checkSaveValue(item, _responseObject, responseObject)
                    try {
                        if (item.type == "check_http_ok" || item.type == "check_wss_ok") {
                            if (item.not) {
                                await expect(response).not.myToBe(200);
                            }
                            else {
                                await expect(response).myToBe(200);
                            }
                        }
                        else if (item.type == "check_redirection") {
                            if (item.not) {
                                await expect(response).not.myToBe(302);
                            }
                            else {
                                await expect(response).myToBe(302);
                            }
                        }
                        else if (item.type == "check_value") {
                            if (item.not) {
                                await expect(responseObject[item.key]).not.toBe(item.value);
                            }
                            else {
                                await expect(responseObject[item.key]).toBe(item.value);
                            }
                        }
                        else if (item.type == "check_array_first_value") {
                            await Promise.all(item.key.map(async (itemKey, idx) => {
                                let checkValue = getValue(item.value[idx]);
                                await expect(responseObject[itemKey]).toBe(checkValue);
                            }));

                        }
                    }
                    catch (e) {
                        throw e;  // <= set your breakpoint here
                    }
                });
            });
        }
    }
    );
}
module.exports.test = test;