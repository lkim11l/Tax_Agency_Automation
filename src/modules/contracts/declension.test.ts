import { describe, expect, it } from "vitest";

import {
  declineSignerAuthorityGenitive,
  declineSignerNameGenitive,
  declineSignerPositionGenitive,
} from "./declension";

describe("declineSignerPositionGenitive", () => {
  it("declines the known position", () => {
    expect(declineSignerPositionGenitive("Генеральный директор")).toEqual({
      reliable: true,
      value: "генерального директора",
    });
  });

  it("leaves an unknown position unreliable rather than guessing", () => {
    expect(declineSignerPositionGenitive("Заместитель по развитию")).toEqual({
      reliable: false,
      value: null,
    });
  });
});

describe("declineSignerNameGenitive", () => {
  it("declines the known full name", () => {
    expect(declineSignerNameGenitive("Иванов Иван Иванович")).toEqual({
      reliable: true,
      value: "Иванова Ивана Ивановича",
    });
  });

  it("declines other regular -ов/-ев/-ин surnames and patronymics", () => {
    expect(declineSignerNameGenitive("Петров Сергей Сергеевич")).toEqual({
      reliable: true,
      value: "Петрова Сергея Сергеевича",
    });
    expect(declineSignerNameGenitive("Пушкин Александр Сергеевич")).toEqual({
      reliable: true,
      value: "Пушкина Александра Сергеевича",
    });
  });

  it("declines adjectival -ский/-цкий surnames", () => {
    expect(declineSignerNameGenitive("Высоцкий Владимир Семёнович")).toEqual({
      reliable: true,
      value: "Высоцкого Владимира Семёновича",
    });
  });

  it("leaves a name with an unlisted given name unreliable", () => {
    expect(declineSignerNameGenitive("Иванов Радомир Иванович")).toEqual({
      reliable: false,
      value: null,
    });
  });

  it("leaves a name with an irregular surname unreliable", () => {
    expect(declineSignerNameGenitive("Ким Иван Иванович")).toEqual({
      reliable: false,
      value: null,
    });
  });

  it("leaves a two-part or four-part name unreliable", () => {
    expect(declineSignerNameGenitive("Иванов Иван").reliable).toBe(false);
    expect(declineSignerNameGenitive("Иванов Иван Иванович Второй").reliable).toBe(false);
  });

  it("declines a known feminine full name", () => {
    expect(declineSignerNameGenitive("Иванова Мария Ивановна")).toEqual({
      reliable: true,
      value: "Ивановой Марии Ивановны",
    });
  });

  it("declines other regular feminine -ова/-ева/-ина surnames and patronymics", () => {
    expect(declineSignerNameGenitive("Петрова Елена Сергеевна")).toEqual({
      reliable: true,
      value: "Петровой Елены Сергеевны",
    });
    expect(declineSignerNameGenitive("Пушкина Анна Кузьминична")).toEqual({
      reliable: true,
      value: "Пушкиной Анны Кузьминичны",
    });
  });

  it("declines adjectival feminine -ская/-цкая surnames", () => {
    expect(declineSignerNameGenitive("Высоцкая Ольга Семёновна")).toEqual({
      reliable: true,
      value: "Высоцкой Ольги Семёновны",
    });
  });

  it("leaves a feminine name with an unlisted given name unreliable", () => {
    expect(declineSignerNameGenitive("Иванова Радомира Ивановна")).toEqual({
      reliable: false,
      value: null,
    });
  });

  it("leaves a feminine name with an irregular surname unreliable", () => {
    expect(declineSignerNameGenitive("Ким Мария Ивановна")).toEqual({
      reliable: false,
      value: null,
    });
  });
});

describe("declineSignerAuthorityGenitive", () => {
  it("declines Устав", () => {
    expect(declineSignerAuthorityGenitive("Устав")).toEqual({
      reliable: true,
      value: "Устава",
    });
  });

  it("declines a power of attorney, keeping the number/date untouched", () => {
    expect(declineSignerAuthorityGenitive("доверенность №5 от 01.02.2026")).toEqual({
      reliable: true,
      value: "доверенности №5 от 01.02.2026",
    });
  });

  it("declines an order, keeping the number/date untouched", () => {
    expect(declineSignerAuthorityGenitive("приказ №3 от 01.02.2026")).toEqual({
      reliable: true,
      value: "приказа №3 от 01.02.2026",
    });
  });

  it("leaves an unrecognized basis unreliable", () => {
    expect(declineSignerAuthorityGenitive("устное распоряжение учредителя")).toEqual({
      reliable: false,
      value: null,
    });
  });

  it("leaves an empty basis unreliable", () => {
    expect(declineSignerAuthorityGenitive("")).toEqual({ reliable: false, value: null });
  });
});
