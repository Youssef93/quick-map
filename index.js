'use strict';

const Utilities = require('./Utilities');

const getAndRepeatData = function(data, path) {

  if(path.includes('[')) {
    const arrayindx = path.indexOf('[');
    const pathWithoutArray = path.substring(0, arrayindx);
    const resultParent = data[pathWithoutArray]

    if(!resultParent || !Utilities.isArray(resultParent)) return [];
    const index = path.substr(arrayindx).toString().replace('[', '').replace(']', '')
    return [resultParent[index]]
  }

  const result = data[path];

  if(!result) return [];

  if(!Utilities.isArray(result)) {
    return [result]
  }

  return result;
}

const abstractPathToData = function(data, path) {
  const pathParts = path.split('.');

  let currentData = getAndRepeatData(data, pathParts[0]);
  pathParts.shift();

  while(pathParts.length) {
    const newPathPart = pathParts[0];
    const newDataParts = [];

    currentData.forEach((obj) => {
      newDataParts.push(...getAndRepeatData(obj, newPathPart));
    });

    currentData = newDataParts;
    pathParts.shift();
  }

  return currentData;
}

const mapObject = function(data, mappingSchema, aliases) {
  const context = {};

  Object.keys(aliases).forEach(aliasKey => {
    const resolvedObject = abstractPathToData(data, aliases[aliasKey]);
    context[`$$${aliasKey}`] = resolvedObject;
  });

  return mapSchema(data, mappingSchema, context)
}

const execCondition = function(data, valueSchema, context) {
  valueSchema = valueSchema.replace('$cond', '');

  const SUPPORTED_OPERATORS = [
    {
      operator: '!=',
      fn: (LHS, RHS) => LHS != RHS
    },
    {
      operator: '>=',
      fn: (LHS, RHS) => LHS >= RHS
    },
    {
      operator: '<=',
      fn: (LHS, RHS) => LHS <= RHS
    },
    {
      operator: '=',
      fn: (LHS, RHS) => LHS == RHS
    },
    {
      operator: '>',
      fn: (LHS, RHS) => LHS > RHS
    },
    {
      operator: '<',
      fn: (LHS, RHS) => LHS < RHS
    },
    {
      operator: '$!includes',
      fn: (LHS, RHS) => !LHS.includes(RHS)
    },
    {
      operator: '$includes',
      fn: (LHS, RHS) => LHS.includes(RHS)
    },
    {
      operator: '$exitsts',
      fn: (LHS, RHS) => ( LHS && RHS == 'true') || (!LHS && RHS == 'false')
    }
  ];

  const conditionParts = valueSchema.split(':');

  const [condition, firstResolve] = conditionParts[0].split('?');
  const secondResolve = conditionParts[1];

  let conditionSatisified = false;

  for(let i = 0; i < SUPPORTED_OPERATORS.length; i++) {
    const x = SUPPORTED_OPERATORS[i];
    if(condition.includes(x.operator)) {
      let [LHS, RHS] = condition.split(x.operator);

      LHS = loadValue(data, LHS.trim(), context);
      RHS = loadValue(data, RHS.trim(), context);

      conditionSatisified = x.fn(LHS, RHS);

      break;
    }
  }

  if(conditionSatisified) return loadValue(data, firstResolve.trim(), context);
  return loadValue(data, secondResolve.trim(), context);
}

const loadValue = function(data, valueSchema, context) {
  if(Utilities.startsWith(valueSchema, '@')) return abstractPathToData(data, valueSchema.replace('@', ''))[0];
  
  if(Utilities.startsWith(valueSchema, '$$')) {
    const pathWithoutContext = valueSchema.split('.')
    const contextVariable = pathWithoutContext.shift();
    const objectInContext = context[contextVariable];
    if(!pathWithoutContext.length) return objectInContext;
    return loadValue(objectInContext, `@${pathWithoutContext.join('.')}`, context); 
  }

  if(Utilities.startsWith(valueSchema, '$cond')) return execCondition(data, valueSchema, context)
  
  return valueSchema;
}

const mapSchema = function(data, mappingSchema, context) {
  const result = {};

  if(Utilities.isObject(mappingSchema)) {
    Object.keys(mappingSchema).forEach(keyInMappingScheam => {
      const valueSchema = mappingSchema[keyInMappingScheam];
  
      if(Utilities.isArray(valueSchema)) result[keyInMappingScheam] = mapArray(data,valueSchema[0], context);
      else if(Utilities.isObject(valueSchema)) result[keyInMappingScheam] = mapSchema(data, valueSchema, context);
      else result[keyInMappingScheam] = loadValue(data, valueSchema, context);
      
    });
  
    return result;
  }

  return loadValue(data, mappingSchema, context);
}

const mapArray = function(data, mappingSchema, context) {
  const { aliases, find, filter, pick, map } = mappingSchema;

  if(aliases) {
    const aliasesRequired = aliases.split('$$and').map(aliasForArray => aliasForArray.trim());
    let result = [];

    let breakFlag = false;

    for(let i = 0; i < aliasesRequired.length; i++) {
      const aliasForArray = aliasesRequired[i];
      const objectInContext = context[aliasForArray];

      if(objectInContext && Utilities.isArray(objectInContext)) {
        context[`$$ORIGINAL___${aliasForArray}`] = objectInContext;

        for(let j = 0; j < context[`$$ORIGINAL___${aliasForArray}`].length; j++) {
          context[aliasForArray] = context[`$$ORIGINAL___${aliasForArray}`][j];

          if(filter && execCondition(data, filter, context)) result.push(mapSchema(data, map || pick, context));

          else if (find && execCondition(data, filter, context)) {
            breakFlag = true;
            result = mapSchema(data, map || pick, context);
          }

          else result.push(mapSchema(data, map || pick, context));
    
          context[aliasForArray] = context[`$$ORIGINAL___${aliasForArray}`];
        }
      }

      context[`$$ORIGINAL___${aliasForArray}`] = undefined;
      if(breakFlag) break;
    }

    return result;
  }

  else if (map) {
    if (!Utilities.isArray(map)) throw new Error('map attribute must be an array in case the attribute \'aliases\' is absent.');
    return map.map(mapSubItem => map(data, mapSubItem, context));
  }

  else if (pick) {
    if (!Utilities.isArray(pick)) throw new Error('pick attribute must be an array in case the attribute \'aliases\' is absent.');
    return pick.map(p => map(data, p, context));
  }
}

module.exports = {
  abstractPathToData, mapObject
}